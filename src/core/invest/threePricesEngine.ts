import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
import type { LedgerEvent } from './CustodyEngine';

export type ThreePrices = {
  qty: number;
  estrito: number;
  b3: number;
  gerencial: number;
  lotStart: string | null;
};

type OptionSeriesState = {
  ticker: string;
  /** Positivo = comprado; negativo = vendido. */
  qtyAtual: number;
  /** Líquido (vendas − compras), ainda não consumido por exercício. */
  premioLiquido: number;
  /** Parcela do `premioLiquido` que já foi computada em `premioOpcoesPeriodo`
   *  (operações ocorridas com a ação em carteira). O complemento é "pré-lote",
   *  só entra no gerencial se a opção for exercida e gerar entrada de ações. */
  premioContadoGerencial: number;
};

type UnderlyingState = {
  underlying: string;
  qty: number;
  estritoTotal: number;
  b3AjusteTotal: number;
  premioOpcoesPeriodo: number;
  lotStart: string | null;
  optionSeries: Map<string, OptionSeriesState>;
};

const STOCK_LIKE = new Set(['stock', 'fii']);
const OPTION_LIKE = new Set(['option_call', 'option_put']);

const OPTION_SELL_TX = new Set(['put_sell', 'call_sell']);
const OPTION_BUY_TX = new Set(['put_buy', 'call_buy']);

const IGNORED_TX = new Set([
  'dividend',
  'jcp',
  'cash_yield',
  'securities_lending',
  'capital_deposit',
  'capital_withdrawal',
  'penalty_b3',
  'fee',
  'revaluation',
  'pending_settlement',
]);

function emptyState(underlying: string): UnderlyingState {
  return {
    underlying,
    qty: 0,
    estritoTotal: 0,
    b3AjusteTotal: 0,
    premioOpcoesPeriodo: 0,
    lotStart: null,
    optionSeries: new Map(),
  };
}

function resetState(s: UnderlyingState): void {
  s.qty = 0;
  s.estritoTotal = 0;
  s.b3AjusteTotal = 0;
  s.premioOpcoesPeriodo = 0;
  s.lotStart = null;
  s.optionSeries.clear();
}

function getOptionSeries(s: UnderlyingState, ticker: string): OptionSeriesState {
  let series = s.optionSeries.get(ticker);
  if (!series) {
    series = { ticker, qtyAtual: 0, premioLiquido: 0, premioContadoGerencial: 0 };
    s.optionSeries.set(ticker, series);
  }
  return series;
}

function effectiveAssetType(e: LedgerEvent): string {
  const declared = String(e.asset_type || '').trim();
  if (declared) return declared;
  return inferAssetType(String(e.asset_ticker || ''));
}

function impactsPrice(flag: LedgerEvent['impacts_managerial_price']): boolean {
  if (flag === false || flag === 0) return false;
  return true;
}

function eventDate(e: LedgerEvent): string {
  return String(e.transaction_date ?? '');
}

function sortEntries(entries: LedgerEvent[]): LedgerEvent[] {
  return [...entries].sort((a, b) => {
    const da = eventDate(a);
    const db = eventDate(b);
    if (da !== db) return da.localeCompare(db);
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Custo positivo de uma compra de ação (inclui emolumentos/taxas/IRRF). */
function buyCost(e: LedgerEvent): number {
  const net = Number(e.total_net_value ?? 0);
  if (net < 0) return -net;
  // Fallback quando total_net_value vem ausente/positivo (lançamento antigo).
  const q = Math.abs(Number(e.quantity ?? 0));
  const p = Number(e.unit_price ?? 0);
  return q * p;
}

/** Reduz totais proporcionais à fração vendida — preserva PM Estrito e PM B3. */
function applyProportionalReduction(s: UnderlyingState, qtyOut: number): void {
  if (s.qty <= 0) return;
  const q = Math.min(qtyOut, s.qty);
  const frac = q / s.qty;
  s.estritoTotal -= s.estritoTotal * frac;
  s.b3AjusteTotal -= s.b3AjusteTotal * frac;
  s.qty -= q;
  if (s.qty <= 1e-9) resetState(s);
}

function applyStockBuy(s: UnderlyingState, e: LedgerEvent): void {
  const q = Math.abs(Number(e.quantity ?? 0));
  if (q <= 0) return;
  const type = String(e.transaction_type);
  const cost =
    type === 'opening_balance' || type === 'bonus'
      ? q * Number(e.unit_price ?? 0)
      : buyCost(e);
  if (s.qty <= 0) s.lotStart = eventDate(e);
  s.qty += q;
  s.estritoTotal += cost;
}

function applyStockSell(s: UnderlyingState, e: LedgerEvent): void {
  const q = Math.abs(Number(e.quantity ?? 0));
  if (q <= 0) return;
  applyProportionalReduction(s, q);
}

function applySplit(s: UnderlyingState, e: LedgerEvent): void {
  const newQty = Number(e.quantity ?? 0);
  if (!Number.isFinite(newQty) || newQty <= 0 || s.qty <= 0) return;
  // Mantém custo total; divide na nova qty.
  s.qty = newQty;
}

function applyOptionTrade(s: UnderlyingState, e: LedgerEvent): void {
  const type = String(e.transaction_type);
  const ticker = String(e.asset_ticker || '').toUpperCase();
  if (!ticker) return;
  const series = getOptionSeries(s, ticker);
  const q = Math.abs(Number(e.quantity ?? 0));
  const net = Number(e.total_net_value ?? 0);

  // Gerencial só conta opção quando a ação está em carteira. Antes do lote
  // abrir (ou após zerar), a série acumula em `premioLiquido` mas não toca em
  // `premioOpcoesPeriodo` — esse prêmio "pré-lote" só ressuscita se a opção
  // for exercida e gerar entrada de ações (tratado em applyOptionExercise).
  if (OPTION_SELL_TX.has(type)) {
    series.qtyAtual -= q;
    series.premioLiquido += net;
    if (s.qty > 0) {
      s.premioOpcoesPeriodo += net;
      series.premioContadoGerencial += net;
    }
    return;
  }
  if (OPTION_BUY_TX.has(type)) {
    series.qtyAtual += q;
    series.premioLiquido += net;
    if (s.qty > 0) {
      s.premioOpcoesPeriodo += net;
      series.premioContadoGerencial += net;
    }
    return;
  }
}

function applyOptionExercise(s: UnderlyingState, e: LedgerEvent): void {
  const ticker = String(e.asset_ticker || '').toUpperCase();
  const q = Math.abs(Number(e.quantity ?? 0));
  if (!ticker || q <= 0) return;

  const series = getOptionSeries(s, ticker);
  const optType = effectiveAssetType(e);
  const isPut = optType === 'option_put';
  const isCall = optType === 'option_call';
  if (!isPut && !isCall) return;

  const positionShort = series.qtyAtual < -1e-9; // vendido
  const positionLong = series.qtyAtual > 1e-9; // comprado
  const openAbs = Math.abs(series.qtyAtual);
  const exercised = Math.min(q, openAbs);
  if (exercised <= 0) return;

  const frac = openAbs > 0 ? exercised / openAbs : 0;
  const allocated = frac * series.premioLiquido;
  const alreadyCounted = frac * series.premioContadoGerencial;

  /** Em exercício que gera ENTRADA de ações (PUT vendida ou CALL comprada
   *  exercida), todo o prêmio da série ainda não computado no Gerencial entra
   *  agora — inclusive a parte das opções da mesma série que não foram
   *  exercidas (vão expirar ou ainda estão em aberto). Regra: uma opção da
   *  série foi exercida → série inteira impacta o PM Gerencial daquele lote. */
  const naoContadoSerie = series.premioLiquido - series.premioContadoGerencial;

  if (isPut && positionShort) {
    const strike = Number(e.unit_price ?? 0);
    if (s.qty <= 0) s.lotStart = eventDate(e);
    s.qty += exercised;
    s.estritoTotal += exercised * strike;
    s.b3AjusteTotal += allocated;
    s.premioOpcoesPeriodo += naoContadoSerie;
    series.qtyAtual += exercised;
    series.premioLiquido -= allocated;
    // Após absorver tudo no Gerencial e consumir o proporcional, o contado
    // acompanha o restante do premioLiquido.
    series.premioContadoGerencial = series.premioLiquido;
    return;
  }

  if (isCall && positionLong) {
    const strike = Number(e.unit_price ?? 0);
    if (s.qty <= 0) s.lotStart = eventDate(e);
    s.qty += exercised;
    s.estritoTotal += exercised * strike;
    s.b3AjusteTotal += allocated;
    s.premioOpcoesPeriodo += naoContadoSerie;
    series.qtyAtual -= exercised;
    series.premioLiquido -= allocated;
    series.premioContadoGerencial = series.premioLiquido;
    return;
  }

  if (isPut && positionLong) {
    // PUT comprada exercida → saída forçada de ações. Não toca em Gerencial
    // (saída não ressuscita prêmio pré-lote).
    applyProportionalReduction(s, exercised);
    series.qtyAtual -= exercised;
    series.premioLiquido -= allocated;
    series.premioContadoGerencial -= alreadyCounted;
    return;
  }

  if (isCall && positionShort) {
    // CALL vendida exercida → saída forçada de ações.
    applyProportionalReduction(s, exercised);
    series.qtyAtual += exercised;
    series.premioLiquido -= allocated;
    series.premioContadoGerencial -= alreadyCounted;
    return;
  }
}

function applyEvent(s: UnderlyingState, e: LedgerEvent): void {
  if (!impactsPrice(e.impacts_managerial_price)) return;

  const type = String(e.transaction_type);
  if (IGNORED_TX.has(type)) return;

  const assetType = effectiveAssetType(e);

  if (STOCK_LIKE.has(assetType)) {
    if (type === 'buy' || type === 'opening_balance' || type === 'bonus') {
      applyStockBuy(s, e);
      return;
    }
    if (type === 'sell') {
      applyStockSell(s, e);
      return;
    }
    if (type === 'split') {
      applySplit(s, e);
      return;
    }
    return;
  }

  if (OPTION_LIKE.has(assetType)) {
    if (
      OPTION_SELL_TX.has(type) ||
      OPTION_BUY_TX.has(type)
    ) {
      applyOptionTrade(s, e);
      return;
    }
    if (type === 'option_exercise') {
      applyOptionExercise(s, e);
      return;
    }
    return;
  }
}

function snapshot(s: UnderlyingState): ThreePrices {
  if (s.qty <= 0) {
    return { qty: 0, estrito: 0, b3: 0, gerencial: 0, lotStart: s.lotStart };
  }
  const estrito = s.estritoTotal / s.qty;
  const b3 = (s.estritoTotal - s.b3AjusteTotal) / s.qty;
  const gerencial = (s.estritoTotal - s.premioOpcoesPeriodo) / s.qty;
  return {
    qty: round4(s.qty),
    estrito: round4(estrito),
    b3: round4(b3),
    gerencial: round4(gerencial),
    lotStart: s.lotStart,
  };
}

/**
 * Calcula os três preços (Estrito / B3 / Gerencial) por ação mãe, processando
 * o livro razão em ordem cronológica. Sem FIFO/LIFO: a cada nova entrada o
 * lote inteiro é recalculado. Reset total quando qty zera.
 *
 * Modelo formal documentado em [tasks/wave-2/01-engine-tres-precos.md].
 */
export function computeThreePricesByUnderlying(
  entries: LedgerEvent[]
): Map<string, ThreePrices> {
  const sorted = sortEntries(entries);
  const states = new Map<string, UnderlyingState>();

  for (const e of sorted) {
    const ticker = String(e.asset_ticker || '');
    const assetType = effectiveAssetType(e);
    if (!STOCK_LIKE.has(assetType) && !OPTION_LIKE.has(assetType)) continue;

    const underlying = inferUnderlyingTicker(
      ticker,
      e.underlying_ticker ? String(e.underlying_ticker) : undefined
    );
    if (!underlying) continue;

    let state = states.get(underlying);
    if (!state) {
      state = emptyState(underlying);
      states.set(underlying, state);
    }
    applyEvent(state, e);
  }

  const out = new Map<string, ThreePrices>();
  for (const [u, s] of states) {
    out.set(u, snapshot(s));
  }
  return out;
}
