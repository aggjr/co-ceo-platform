/**
 * Parser de linhas do extrato BTG (texto extraído do PDF).
 * Ignora liquidações agregadas de bolsa — o detalhe vem do myProfit / notas.
 */
import { MAIN_CASH_TICKER } from './ledgerTypes';
import type { InvestImportRule } from './ledgerTypes';
import { inferAssetType, isFixedIncomeTicker } from './assetClassifier';
import {
  netZeroCustodyFeePairs,
  splitNetZeroCustodyMoves,
  type PendingGenericCustodyMove,
} from './custodyFeeNetting';
import { harmonizeQuantityWithFinancialAmount } from './financialQuantityCoherence';
import {
  allocateLftLotForBuy,
  type LftInvestmentLot,
} from './lftInvestmentStatementLots';

const B3_TICKER_RE = /\b([A-Z]{4}\d{1,2})\b/;

const LFT_TICKER_RE = /LFT\s+(\d{2})\/(\d{2})\/(\d{4})/i;

export type BtgParsedLine = {
  date: string;
  description: string;
  balance: number;
  movementAmount: number;
  /** Valor líquido com sinal: positivo = entra na conta. */
  signedCash: number;
};

const BR_NUMBER = /(\d{1,3}(?:\.\d{3})*,\d{2}|-\d{1,3}(?:\.\d{3})*,\d{2})/g;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/;

export function parseBrNumber(raw: string): number {
  const t = raw.trim().replace(/\./g, '').replace(',', '.');
  return Number(t);
}

function resolveBalanceAndMovementFromPrevious(
  previousBalance: number,
  a: number,
  b: number
): { balance: number; movement: number; signedMovement?: number } {
  const tol = 0.02;
  const near = (x: number, y: number) => Math.abs(x - y) <= tol;
  const fitA = near(Math.abs(previousBalance - a), Math.abs(b));
  const fitB = near(Math.abs(previousBalance - b), Math.abs(a));
  if (fitA && !fitB) return { balance: a, movement: Math.abs(b) };
  if (fitB && !fitA) return { balance: b, movement: Math.abs(a) };

  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (near(hi + lo, previousBalance) && previousBalance > 0) {
    const hiRatio = hi / previousBalance;
    if (hiRatio > 0.999 || lo < 100) return { balance: hi, movement: Math.abs(lo) };
    return { balance: lo, movement: Math.abs(hi) };
  }

  if (Math.abs(b) > 0 && Math.abs(a) > 0 && Math.abs(b) <= Math.abs(a) * 0.01) {
    return { balance: a, movement: Math.abs(b), signedMovement: b };
  }

  return { balance: hi, movement: Math.abs(lo) };
}

export function parseBtgMovementLine(
  line: string,
  previousBalance: number | null
): BtgParsedLine | null {
  const m = line.match(DATE_RE);
  if (!m) return null;

  const [, dd, mm, yyyy, rest] = m;
  const numbers = [...rest.matchAll(BR_NUMBER)].map((x) => x[1]);
  if (numbers.length < 2) return null;

  /** BTG PDF: penúltimo = saldo após lançamento; último = valor do lançamento. */
  const a = parseBrNumber(numbers[numbers.length - 2]!);
  const b = parseBrNumber(numbers[numbers.length - 1]!);
  const resolved =
    previousBalance != null && !Number.isNaN(previousBalance)
      ? resolveBalanceAndMovementFromPrevious(previousBalance, a, b)
      : { balance: a, movement: Math.abs(b) };
  const balance = resolved.balance;
  const movementAmount = resolved.movement;
  const descEnd = rest.lastIndexOf(numbers[numbers.length - 2]!);
  const description = rest.slice(0, descEnd).trim();

  let signedCash = movementAmount;
  if (previousBalance != null && !Number.isNaN(previousBalance)) {
    const delta = Math.round((balance - previousBalance) * 100) / 100;
    signedCash = resolved.signedMovement ?? delta;
    if (description.toUpperCase().includes('TED ENVIADA')) {
      signedCash = -Math.abs(movementAmount);
    }
  }

  const upperDesc = description.toUpperCase();
  if (upperDesc.includes('LIQ BOLSA') && upperDesc.includes('OPERAC')) {
    // PDF BTG: ultima coluna = credito da liquidacao (nao delta de saldo quando ha debitos ocultos).
    signedCash = Math.abs(parseBrNumber(numbers[numbers.length - 1]!));
  } else if (
    upperDesc.includes('LIQ BOLSA') &&
    /BTC|ALUGUEL|CORRETAGEM/i.test(upperDesc)
  ) {
    signedCash = -Math.abs(parseBrNumber(numbers[numbers.length - 1]!));
  }

  return {
    date: `${yyyy}-${mm}-${dd}`,
    description,
    balance,
    movementAmount,
    signedCash,
  };
}

/** Valor financeiro de compra/venda TD a partir da linha do extrato. */
export function extractTdSpotFinancialAmount(parsed: BtgParsedLine, line?: string): number {
  const desc = parsed.description.toUpperCase();
  const mov = parsed.movementAmount > 0.005 ? parsed.movementAmount : 0;
  const cash = Math.abs(Number.isFinite(parsed.signedCash) ? parsed.signedCash : 0);

  if (/VENDA DE TESOURO DIRETO/.test(desc)) {
    if (line) {
      const fromLast = extractLastMovementAmountFromLine(line);
      if (fromLast != null) return fromLast;
    }
    if (cash > 0.005) return cash;
    return mov;
  }

  if (/COMPRA DE TESOURO DIRETO/.test(desc)) {
    if (line) {
      const numbers = [...line.matchAll(BR_NUMBER)].map((x) => parseBrNumber(x[1]!));
      if (numbers.length >= 2) {
        const last = Math.abs(numbers[numbers.length - 1]!);
        const prevNum = Math.abs(numbers[numbers.length - 2]!);
        const hi = Math.max(last, prevNum);
        const lo = Math.min(last, prevNum);
        // Valor da compra = maior montante (saldo residual na linha é muito menor).
        if (hi > 500 && (lo < hi * 0.05 || hi > lo * 1.5)) return hi;
      }
    }
    if (mov > 0.005) return mov;
    if (cash > 0.005) return cash;
    if (line) {
      const numbers = [...line.matchAll(BR_NUMBER)].map((x) => parseBrNumber(x[1]!));
      if (numbers.length >= 2) {
        return Math.max(
          Math.abs(numbers[numbers.length - 1]!),
          Math.abs(numbers[numbers.length - 2]!)
        );
      }
    }
    return 0;
  }

  if (mov > 0.005) return mov;
  return cash;
}

/** PDF BTG: penultimo numero = saldo; ultimo = valor do lancamento (taxa/IRRF/provento da linha). */
export function extractLastMovementAmountFromLine(line: string): number | null {
  const numbers = [...line.matchAll(BR_NUMBER)].map((x) => parseBrNumber(x[1]!));
  if (numbers.length < 2) return null;
  const last = numbers[numbers.length - 1]!;
  if (!Number.isFinite(last)) return null;
  return Math.round(Math.abs(last) * 100) / 100;
}

/** Despesa/taxa de linha BTG: ultima coluna do PDF; fallback delta de caixa ou movement. */
export function resolveExtractLineExpenseAmount(parsed: BtgParsedLine, line?: string): number {
  const fromLine = line ? extractLastMovementAmountFromLine(line) : null;
  if (fromLine != null && fromLine > 0.005) return fromLine;

  const delta = Math.abs(parsed.signedCash);
  const movement = Math.abs(parsed.movementAmount);
  if (delta > 0.005 && movement > 0.005) {
    return Math.round(Math.min(delta, movement) * 100) / 100;
  }
  const pick = delta > 0.005 ? delta : movement;
  return pick > 0.005 ? Math.round(pick * 100) / 100 : 0;
}

/** IRRF/taxa TD: usa a ultima coluna do extrato; fallback para delta de caixa plausivel. */
export function resolveTdExtractFeeAmount(parsed: BtgParsedLine, line?: string): number {
  const fromLine = line ? extractLastMovementAmountFromLine(line) : null;
  if (fromLine != null && fromLine > 0.005) return fromLine;

  const delta = Math.abs(parsed.signedCash);
  const movement = Math.abs(parsed.movementAmount);
  const TD_FEE_MAX = 10_000;
  const candidates = [delta, movement].filter((n) => n > 0.005);
  if (candidates.length === 0) return 0;
  const plausible = candidates.filter((n) => n <= TD_FEE_MAX);
  const pick = plausible.length > 0 ? Math.min(...plausible) : Math.min(...candidates);
  return Math.round(pick * 100) / 100;
}

export type BtgLedgerMapping = {
  operation: string;
  ticker: string;
  asset_type?: string;
  underlying_ticker?: string;
  skip?: boolean;
  notes?: string;
};

const CASH_TICKER = MAIN_CASH_TICKER;
const UNKNOWN_TESOURO_DIRETO_TICKER = 'TD-TESOURO-DIRETO';

type TesouroDiretoMovement = {
  date: string;
  ticker: string;
  operation: 'buy' | 'sell';
  quantity: number;
  unitPrice: number;
  gross: number;
  used?: boolean;
};

function parseLftTicker(description: string): string {
  const match = description.match(LFT_TICKER_RE);
  if (!match) return UNKNOWN_TESOURO_DIRETO_TICKER;
  const [, dd, mm, yyyy] = match;
  return `LFT-${yyyy}${mm}${dd}`;
}

function parseBrFlexible(raw: string): number {
  const t = String(raw || '').trim();
  if (!t || t === '-') return 0;
  const neg = t.startsWith('-') || t.endsWith('-');
  const n = Number(t.replace(/^-/, '').replace(/-$/, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function shortBrDateToIso(raw: string): string | null {
  const m = String(raw || '').match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

function lftTickerFromShortMaturity(dd: string, mm: string, yy: string): string {
  return `LFT-20${yy}${mm}${dd}`;
}

const TD_SHORT_DATE_LINE_RE = /^(\d{2}\/\d{2}\/\d{2})(?:\b|$)/;
const TD_FULL_DATE_LINE_RE = /^(\d{2}\/\d{2}\/\d{4})(?:\b|$)/;
const TD_DEFINITIVA_RE =
  /^(COMPRA|VENDA)\s+DEFINITIVA\s+(-?[\d.,]+)\s+(-?[\d.]+,\d{4,6})\s+(-?[\d.]+,\d{2})/i;

function tdTickerMatches(rowTicker: string, wanted: string): boolean {
  const row = rowTicker.trim().toUpperCase();
  const want = wanted.trim().toUpperCase();
  if (row === want) return true;
  if (row === UNKNOWN_TESOURO_DIRETO_TICKER || want === UNKNOWN_TESOURO_DIRETO_TICKER) return true;
  if (isFixedIncomeTicker(row) && isFixedIncomeTicker(want)) return true;
  return false;
}

function inferLftTickerFromDocument(lines: string[]): string {
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const match = line.match(/\bLFT\b\s+\d{2}\/\d{2}\/\d{2}\s+(\d{2})\/(\d{2})\/(\d{2})/i);
    if (match) return lftTickerFromShortMaturity(match[1]!, match[2]!, match[3]!);
  }
  return UNKNOWN_TESOURO_DIRETO_TICKER;
}

function extractTesouroDiretoMovements(lines: string[]): TesouroDiretoMovement[] {
  const out: TesouroDiretoMovement[] = [];
  let currentDate: string | null = null;
  let currentTicker: string | null = null;
  const documentLftTicker = inferLftTickerFromDocument(lines);

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const shortDate = line.match(TD_SHORT_DATE_LINE_RE);
    const fullDate = line.match(TD_FULL_DATE_LINE_RE);
    if (shortDate || fullDate) {
      const br = shortDate?.[1] ?? fullDate?.[1]!;
      currentDate = shortDate
        ? shortBrDateToIso(br)
        : br.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
      currentTicker = null;
      if (/\bLFT\b/i.test(line)) {
        const fromLine = line.match(LFT_TICKER_RE);
        currentTicker = fromLine
          ? `LFT-${fromLine[3]}${fromLine[2]}${fromLine[1]}`
          : documentLftTicker;
      }
    }
    if (/^LFT$/i.test(line)) {
      currentTicker = documentLftTicker;
      continue;
    }

    const movement = line.match(TD_DEFINITIVA_RE);
    if (!movement) continue;

    const op = movement[1]!.toUpperCase() === 'COMPRA' ? 'buy' : 'sell';
    const row: TesouroDiretoMovement = {
      date: currentDate ?? '',
      ticker: currentTicker ?? documentLftTicker,
      operation: op,
      quantity: Math.abs(parseBrFlexible(movement[2]!)),
      unitPrice: Math.abs(parseBrFlexible(movement[3]!)),
      gross: Math.abs(parseBrFlexible(movement[4]!)),
    };

    if (!row.date) {
      const descDate = line.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (descDate) row.date = `${descDate[3]}-${descDate[2]}-${descDate[1]}`;
    }
    if (!row.date) continue;

    out.push(row);
  }

  return out;
}

function takeTesouroDiretoMovement(
  rows: TesouroDiretoMovement[],
  date: string,
  ticker: string,
  operation: 'buy' | 'sell',
  gross: number
): TesouroDiretoMovement | null {
  const tolerance = 0.05;
  let best: TesouroDiretoMovement | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.used) continue;
    if (row.date !== date || row.operation !== operation || !tdTickerMatches(row.ticker, ticker)) continue;
    const delta = Math.abs(row.gross - Math.abs(gross));
    if (delta <= tolerance && delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  if (best) {
    best.used = true;
    return best;
  }

  if (operation === 'sell') {
    const sameDay = rows.filter(
      (row) => !row.used && row.date === date && row.operation === operation
    );
    if (sameDay.length === 1) {
      const only = sameDay[0]!;
      only.used = true;
      return only;
    }
    return null;
  }

  let fallback: TesouroDiretoMovement | null = null;
  for (const row of rows) {
    if (row.used) continue;
    if (row.date !== date || row.operation !== operation || !tdTickerMatches(row.ticker, ticker)) continue;
    fallback = row;
    break;
  }
  if (fallback) {
    fallback.used = true;
    return fallback;
  }

  // Último recurso: uma única linha TD no dia (tabela Operações sem ticker explícito).
  const sameDay = rows.filter(
    (row) => !row.used && row.date === date && row.operation === operation
  );
  if (sameDay.length === 1) {
    const only = sameDay[0]!;
    only.used = true;
    return only;
  }
  return null;
}

/** Ticker B3 em descricoes de provento (ex.: "DIVIDENDO PRIO3"). */
function parseProventoTickerFromDescription(description: string): string | null {
  const upper = description.toUpperCase();
  const m = upper.match(B3_TICKER_RE);
  return m ? m[1]! : null;
}

export const IS_GENERIC_CUSTODY_RE =
  /(?:^|\s)(TAXA\s+DE\s+CUST|CUST[ÓO]DIA|REEMBOLSO\s+DE\s+CUST|TAXA\s+SOBRE\s+VALOR\s+EM\s+CUST)/i;

const IS_LIQ_CUSTODY_RE = /LIQ\s+BOLSA.+(?:TAXA\s+SOBRE\s+VALOR\s+EM\s+CUST|CUST[ÓO]DIA)/i;

/** Classifica linha do extrato → operação do livro-razão INVEST. */
export function classifyBtgDescription(
  description: string,
  rules?: InvestImportRule[]
): BtgLedgerMapping {
  const d = description.toUpperCase();

  if (d.includes('REEMBOLSO DE CUST')) {
    return {
      operation: 'cash_yield',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (rules && rules.length > 0) {
    const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
    for (const rule of sortedRules) {
      try {
        const regex = new RegExp(rule.description_pattern, 'i');
        if (regex.test(description)) {
          return {
            operation: rule.mapped_operation,
            ticker: rule.target_asset_type === 'cash' ? CASH_TICKER : 'UNKNOWN_DB_TICKER',
            asset_type: rule.target_asset_type,
            notes: description,
          };
        }
      } catch (e) {
        // Regex invalida cadastrada no banco, ignora
      }
    }
  }

  if (d.includes('LIQ BOLSA')) {
    // Taxa de custodia vem como LIQ BOLSA no extrato — nao entra no pool de notas.
    if (IS_GENERIC_CUSTODY_RE.test(d) || /TAXA\s+SOBRE\s+VALOR\s+EM\s+CUST/i.test(d)) {
      return {
        operation: 'fee',
        ticker: CASH_TICKER,
        asset_type: 'cash',
        notes: description,
      };
    }
    return { operation: 'skip', ticker: CASH_TICKER, skip: true };
  }
  if (d.includes('CONTA REMUNERADA - RESGATE')) {
    return {
      operation: 'cash_yield',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }
  if (d.includes('SALDO FINAL') && d.includes('RENDIMENTO PROVISIONADO')) {
    return {
      operation: 'cash_yield',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('TED ENVIADA')) {
    return {
      operation: 'capital_withdrawal',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }
  if (d.includes('BITO EM C/C VIA CIP')) {
    return {
      operation: 'capital_withdrawal',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }
  if (d.includes('TED RECEBIDA') || d.includes('TED CREDITO')) {
    return {
      operation: 'capital_deposit',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('RENDIMENTO DISPONÍVEL') || d.includes('RENDIMENTO DISPONIVEL')) {
    return {
      operation: 'cash_yield',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: 'Remuneração saldo em conta',
    };
  }

  const proventoTicker = parseProventoTickerFromDescription(description);
  if (d.includes('DIVIDENDO') || d.includes('DIVIDENDOS')) {
    return {
      operation: 'dividend',
      ticker: proventoTicker ?? CASH_TICKER,
      asset_type: proventoTicker ? inferAssetType(proventoTicker) : 'cash',
      underlying_ticker: proventoTicker ?? undefined,
      notes: description,
    };
  }
  if (d.includes('JCP') || d.includes('JUROS SOBRE CAPITAL')) {
    return {
      operation: 'jcp',
      ticker: proventoTicker ?? CASH_TICKER,
      asset_type: proventoTicker ? inferAssetType(proventoTicker) : 'cash',
      underlying_ticker: proventoTicker ?? undefined,
      notes: description,
    };
  }

  if (d.includes('JUROS SOBRE SALDO NEGATIVO') || d.includes('IOF SOBRE SALDO NEGATIVO')) {
    return {
      operation: 'penalty_b3',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('COMPRA DE TESOURO DIRETO')) {
    return {
      operation: 'buy',
      ticker: parseLftTicker(description),
      asset_type: 'fixed_income',
      notes: description,
    };
  }
  if (d.includes('VENDA DE TESOURO DIRETO')) {
    return {
      operation: 'sell',
      ticker: parseLftTicker(description),
      asset_type: 'fixed_income',
      notes: description,
    };
  }

  if (d.includes('IRRF COBRADO SOBRE OPERACAO DE TESOURO') || d.includes('IRRF - LEI 11.033')) {
    return {
      operation: 'fee',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }
  if (d.includes('IR - BTC')) {
    return {
      operation: 'fee',
      ticker: 'PRIO3',
      asset_type: 'stock',
      underlying_ticker: 'PRIO3',
      notes: description,
    };
  }

  if (d.includes('BTC PRIO3') || d.includes('CORRETAGEM BTC')) {
    return {
      operation: 'securities_lending',
      ticker: 'PRIO3',
      asset_type: 'stock',
      underlying_ticker: 'PRIO3',
      notes: description,
    };
  }

  if (
    d.includes('TAXA') ||
    d.includes('EMOLUMENTOS') ||
    d.includes('CUSTODIA') ||
    d.includes('CUSTÓDIA')
  ) {
    return {
      operation: 'fee',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('REEMBOLSO DE CUSTÓDIA') || d.includes('REEMBOLSO DE CUSTODIA')) {
    return {
      operation: 'fee',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  return { operation: 'extract_divergence', ticker: CASH_TICKER, asset_type: 'cash', skip: false, notes: description };
}

export function getBtgOperationSign(operation: string, description: string): number {
  const d = description.toUpperCase();
  if (['buy', 'capital_withdrawal', 'penalty_b3'].includes(operation)) {
    return -1;
  }
  if (['sell', 'capital_deposit', 'cash_yield', 'dividend', 'jcp'].includes(operation)) {
    return 1;
  }
  if (operation === 'fee') {
    return d.includes('REEMBOLSO') ? 1 : -1;
  }
  if (operation === 'securities_lending') {
    if (d.includes('REMUNERAÇÃO') || d.includes('REMUNERACAO')) {
      return 1;
    }
    return -1;
  }
  return 1;
}

/**
 * Categoria do gasto no extrato (ver docs/architecture/business_events_integration_plan.md):
 *   1 = ligado a operacao patrimonial (vira cost_adjustment no ativo)
 *   2 = despesa recorrente agregada por mes (custodia mensal sem ticker)
 *   3 = movimento financeiro puro (TED, rendimento, capital)
 */
export type ExtractCategory = 1 | 2 | 3;

export type BtgExtractEntry = {
  date: string;
  ticker: string;
  operation: string;
  quantity: number;
  unit_price: number;
  total_net_value: number;
  asset_type?: string;
  underlying_ticker?: string;
  notes?: string;
  /**
   * Header agregador (business_events.source_ref). Multiplas pernas com a
   * mesma chave caem no MESMO business_events.id.
   *   - operacoes TD spot: 'BTG-TD:{date}:{ticker}'
   *   - IRRF/taxa custodia atrelados a TD: mesmo header da TD geradora
   *   - BTC PRIO3 (3 sub-tipos): 'BTG-BTC-PRIO3:{yyyy-mm}'
   *   - custodia mensal isolada: 'BTG-CUSTODIA-MENSAL:{yyyy-mm}'
   *   - TED / rendimento / multa: vazio (cada linha 1 header avulso)
   */
  event_source_ref?: string;
  /** Categoria do gasto (debug/observabilidade). */
  extract_category?: ExtractCategory;
  /** Se true e operation = 'cost_adjustment', custo sobe tambem o pmB. */
  applies_to_b3?: boolean;
  impacts_managerial_price?: boolean;
};

function ymOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function eventSourceRefForTd(date: string, ticker: string): string {
  return `BTG-TD:${date}:${ticker}`;
}

function eventSourceRefForBtcPrio3(monthYM: string): string {
  return `BTG-BTC-PRIO3:${monthYM}`;
}

function eventSourceRefForCustodiaMensal(monthYM: string): string {
  return `BTG-CUSTODIA-MENSAL:${monthYM}`;
}

function eventSourceRefForIrrfOpcaoMensal(monthYM: string): string {
  return `BTG-IRRF-OPCAO-MENSAL:${monthYM}`;
}

/** IRRF retido especificamente sobre op de TD (descricao traz "Tesouro"). */
const IRRF_TD_DESC_RE = /IRRF\s+COBRADO\s+SOBRE\s+OPERACAO\s+DE\s+TESOURO/i;
/** IRRF Lei 11.033/04 sobre opcoes (VENDAS/DAY TRADE) — sem ticker na descricao. */
const IRRF_OPCAO_DESC_RE = /IRRF\s*-\s*LEI\s+11\.033.+OP[CÇ][AÃ]O/i;
const TAXA_TD_DESC_RE = /TAXA.+TESOURO|EMOLUMENTOS.+TESOURO|CUSTODIA.+TESOURO|CUST[ÓO]DIA.+TESOURO/i;
const BTC_PRIO3_DESC_RE = /BTC\s*PRIO3|CORRETAGEM\s*BTC|IR\s*-\s*BTC|TAXA.+BTC\s*PRIO3|REMUNERA[ÇC][ÃA]O.+BTC\s*PRIO3/i;
const NEG_PENALTY_RE = /JUROS\s+SOBRE\s+SALDO\s+NEGATIVO|IOF\s+SOBRE\s+SALDO\s+NEGATIVO/i;

export type BtgExtractParseOptions = {
  /** Inclui LIQ BOLSA como marcador de liquidacao para roteamento pelo LiqBolsaSettlementService. */
  includeLiqBolsa?: boolean;
  importRules?: InvestImportRule[];
  /** Lotes LFT do extrato de investimento — cruzamento qty/PU em compras TD na CC. */
  lftInvestmentLots?: LftInvestmentLot[];
};

export interface BtgExtractResolvers {
  /**
   * Retorna o ticker da opcao vendida (ou ativo principal) no dia util anterior, 
   * para alocar o IRRF Lei 11.033 como cost_adjustment.
   */
  resolveIrrfOpcaoTicker?: (extractDate: string) => { ticker: string; asset_type?: string } | undefined;
  
  /**
   * Retorna lista de ativos comprados no dia util anterior e seus pesos (soma=1.0),
   * para distribuir a multa/juros de saldo negativo como cost_adjustment.
   */
  resolveNegativeBalanceAllocation?: (
    extractDate: string
  ) => Array<{ ticker: string; weight: number; asset_type?: string; underlying_ticker?: string }> | undefined;

  /**
   * Rateio de taxa de custodia mensal por valor em custodia (posicao aberta na data).
   */
  resolveCustodyFeeAllocation?: (
    extractDate: string
  ) => Array<{ ticker: string; weight: number; asset_type?: string; underlying_ticker?: string }> | undefined;

  /**
   * Sem bloco "Operacoes Tesouro" no PDF: infere qty/PU da venda/compra TD pelo valor liquido
   * e PM medio em custodia na data.
   */
  resolveLftSpotFromGross?: (
    extractDate: string,
    ticker: string,
    gross: number,
    operation: 'buy' | 'sell',
    maxQuantity?: number
  ) => { quantity: number; unitPrice: number } | undefined;

  /** Quantidade LFT em custodia imediatamente antes da linha (livro importado). */
  resolveLftQuantityBeforeDate?: (ticker: string, extractDate: string) => number;
}

function lftQtyFromParsedEntries(
  out: BtgExtractEntry[],
  ticker: string,
  extractDate: string
): number {
  let qty = 0;
  const d = extractDate.slice(0, 10);
  const want = ticker.toUpperCase();
  for (const e of out) {
    if (String(e.ticker).toUpperCase() !== want) continue;
    if (String(e.date).slice(0, 10) > d) continue;
    if (e.operation === 'buy') qty += Number(e.quantity) || 0;
    else if (e.operation === 'sell') qty -= Number(e.quantity) || 0;
  }
  return qty;
}

type ExtractAllocationRow = {
  ticker: string;
  weight: number;
  asset_type?: string;
  underlying_ticker?: string;
};

function pushWeightedCostAdjustments(
  out: BtgExtractEntry[],
  parsed: { date: string; description: string },
  allocation: ExtractAllocationRow[],
  totalAmount: number,
  opts: { event_source_ref?: string; notesPrefix: string }
): void {
  let allocated = 0;
  for (let i = 0; i < allocation.length; i += 1) {
    const alloc = allocation[i]!;
    const allocAmount =
      i === allocation.length - 1
        ? Math.round((totalAmount - allocated) * 100) / 100
        : Math.round(totalAmount * alloc.weight * 100) / 100;
    if (i < allocation.length - 1) allocated += allocAmount;
    if (Math.abs(allocAmount) < 0.005) continue;
    const expense = Math.round(Math.abs(allocAmount) * 100) / 100;
    out.push({
      date: parsed.date,
      ticker: alloc.ticker,
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: expense,
      total_net_value: -expense,
      asset_type: alloc.asset_type || 'stock',
      underlying_ticker: alloc.underlying_ticker,
      notes: `${opts.notesPrefix} ${parsed.description}`,
      event_source_ref: opts.event_source_ref,
      extract_category: 1,
      applies_to_b3: false,
    });
  }
}

export function btgLinesToImportEntries(
  lines: string[],
  openingBalance?: number,
  resolvers?: BtgExtractResolvers,
  options?: BtgExtractParseOptions
): BtgExtractEntry[] {
  const out: BtgExtractEntry[] = [];
  let prev = openingBalance ?? null;
  const tesouroMovements = extractTesouroDiretoMovements(lines);

  // Buffer: ultima operacao TD spot por mes (para amarrar IRRF/taxa relacionada).
  // Em D ha a operacao TD; em D+1/D+2 caem IRRF/taxa. Como o extrato vem
  // ordenado cronologicamente, ao processar IRRF ja temos a TD no buffer.
  let lastTdSpot: { date: string; ticker: string; event_source_ref: string } | null = null;
  const pendingCustody: PendingGenericCustodyMove[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('Saldo Inicial') || line.startsWith('Total de')) continue;

    if (line.startsWith('Saldo Inicial')) {
      const nums = [...line.matchAll(BR_NUMBER)].map((x) => parseBrNumber(x[1]!));
      if (nums[0] != null) prev = nums[0];
      continue;
    }

    const parsed = parseBtgMovementLine(line, prev);
    if (!parsed) continue;
    prev = parsed.balance;

    const map = classifyBtgDescription(parsed.description, options?.importRules);
    const upperDesc = parsed.description.toUpperCase();
    if (
      (map.skip || map.operation === 'skip') &&
      options?.includeLiqBolsa &&
      upperDesc.includes('LIQ BOLSA') &&
      !IS_LIQ_CUSTODY_RE.test(upperDesc)
    ) {
      const liqNet = Math.round(parsed.signedCash * 100) / 100;
      out.push({
        date: parsed.date,
        ticker: CASH_TICKER,
        operation: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: liqNet,
        asset_type: 'cash',
        notes: parsed.description,
        extract_category: 3,
      });
      continue;
    }
    if (map.skip || map.operation === 'skip') continue;

    const sign = getBtgOperationSign(map.operation, parsed.description);
    const net = Number.isFinite(parsed.signedCash)
      ? parsed.signedCash
      : sign * Math.abs(parsed.movementAmount);
    const ym = ymOf(parsed.date);

    // Caso 1A — operacao TD spot (compra/venda): registra no buffer mensal.
    if (
      (map.operation === 'buy' || map.operation === 'sell') &&
      map.asset_type === 'fixed_income' &&
      map.ticker.startsWith('LFT-')
    ) {
      const ref = eventSourceRefForTd(parsed.date, map.ticker);
      const ccGross = extractTdSpotFinancialAmount(parsed, line);
      let spotGross = ccGross;
      let lotMatched: LftInvestmentLot | undefined;
      if (map.operation === 'buy' && options?.lftInvestmentLots?.length && ccGross > 0.005) {
        lotMatched = allocateLftLotForBuy(
          options.lftInvestmentLots,
          parsed.date,
          map.ticker,
          ccGross
        );
      }
      const tdMovement = takeTesouroDiretoMovement(
        tesouroMovements,
        parsed.date,
        map.ticker,
        map.operation,
        spotGross
      );

      let sellMaxQty: number | undefined;
      if (map.operation === 'sell' && resolvers?.resolveLftQuantityBeforeDate) {
        const fromLedger =
          resolvers.resolveLftQuantityBeforeDate(map.ticker, parsed.date) ?? 0;
        const fromOut = lftQtyFromParsedEntries(out, map.ticker, parsed.date);
        const available = Math.max(0, fromLedger + fromOut);
        if (available <= 0) {
          out.push({
            date: parsed.date,
            ticker: map.ticker,
            operation: map.operation,
            quantity: 0,
            unit_price: 0,
            total_net_value: Math.round(net * 100) / 100,
            asset_type: map.asset_type,
            underlying_ticker: map.underlying_ticker,
            notes: map.notes ?? parsed.description,
            event_source_ref: ref,
            extract_category: 1,
            impacts_managerial_price: false,
          });
          continue;
        }
        sellMaxQty = available;
      }

      let quantity = 0;
      let unitPrice = 0;
      if (lotMatched) {
        quantity = lotMatched.quantity;
        unitPrice = lotMatched.buyPrice;
      } else if (spotGross > 0.005) {
        const tdQty =
          tdMovement && Math.abs(tdMovement.gross - Math.abs(spotGross)) <= 0.05
            ? tdMovement.quantity
            : undefined;
        const tdPu =
          tdMovement && Math.abs(tdMovement.gross - Math.abs(spotGross)) <= 0.05
            ? tdMovement.unitPrice
            : undefined;

        let harmonized: { quantity: number; unit_price: number } | undefined;
        if (map.operation === 'sell' && resolvers?.resolveLftSpotFromGross) {
          const inferred = resolvers.resolveLftSpotFromGross(
            parsed.date,
            map.ticker,
            spotGross,
            'sell',
            sellMaxQty
          );
          if (inferred) {
            harmonized = { quantity: inferred.quantity, unit_price: inferred.unitPrice };
          }
        }
        if (!harmonized) {
          harmonized = harmonizeQuantityWithFinancialAmount({
            financialAmount: spotGross,
            quantity: tdQty,
            referenceUnitPrice: tdPu,
            maxQuantity: sellMaxQty,
          });
        }
        if (!harmonized && resolvers?.resolveLftSpotFromGross && map.operation === 'buy') {
          const inferred = resolvers.resolveLftSpotFromGross(
            parsed.date,
            map.ticker,
            spotGross,
            'buy'
          );
          if (inferred) {
            harmonized = { quantity: inferred.quantity, unit_price: inferred.unitPrice };
          }
        }
        if (harmonized) {
          quantity = harmonized.quantity;
          unitPrice = harmonized.unit_price;
        }
      }

      const tdSign = getBtgOperationSign(map.operation, parsed.description);
      const tdNet = Math.round(tdSign * spotGross * 100) / 100;
      lastTdSpot = {
        date: parsed.date,
        ticker: map.ticker,
        event_source_ref: ref,
      };
      out.push({
        date: parsed.date,
        ticker: map.ticker,
        operation: map.operation,
        quantity,
        unit_price: unitPrice,
        total_net_value: Math.round(tdNet * 100) / 100,
        asset_type: map.asset_type,
        underlying_ticker: map.underlying_ticker,
        notes: map.notes ?? parsed.description,
        event_source_ref: ref,
        extract_category: 1,
        impacts_managerial_price: quantity > 0 ? undefined : false,
      });
      continue;
    }

    // Caso 1B — IRRF retido sobre TD: vira cost_adjustment no LFT da TD geradora.
    if (IRRF_TD_DESC_RE.test(upperDesc) && lastTdSpot) {
      const td = lastTdSpot;
      const expense = resolveTdExtractFeeAmount(parsed, line);
      if (expense >= 0.005) {
        out.push({
          date: parsed.date,
          ticker: td.ticker,
          operation: 'cost_adjustment',
          quantity: 0,
          unit_price: expense,
          total_net_value: -expense,
          asset_type: 'fixed_income',
          notes: parsed.description,
          event_source_ref: td.event_source_ref,
          extract_category: 1,
          applies_to_b3: false,
        });
      }
      continue;
    }

    // Caso 1C — taxa/emolumentos/custodia explicitamente TD: cost_adjustment no LFT.
    if (TAXA_TD_DESC_RE.test(upperDesc) && lastTdSpot) {
      const td = lastTdSpot;
      const expense = resolveTdExtractFeeAmount(parsed, line);
      if (expense >= 0.005) {
        out.push({
          date: parsed.date,
          ticker: td.ticker,
          operation: 'cost_adjustment',
          quantity: 0,
          unit_price: expense,
          total_net_value: -expense,
          asset_type: 'fixed_income',
          notes: parsed.description,
          event_source_ref: td.event_source_ref,
          extract_category: 1,
          applies_to_b3: false,
        });
      }
      continue;
    }

    // Caso 1E — IRRF Lei 11.033/04 sobre OPCAO: agregado em header mensal (ou alocado via resolver).
    if (IRRF_OPCAO_DESC_RE.test(upperDesc)) {
      const resolved = resolvers?.resolveIrrfOpcaoTicker?.(parsed.date);
      if (resolved) {
        out.push({
          date: parsed.date,
          ticker: resolved.ticker,
          operation: 'cost_adjustment',
          quantity: 0,
          unit_price: Math.abs(parsed.movementAmount),
          total_net_value: Math.abs(parsed.movementAmount),
          asset_type: resolved.asset_type ?? 'option',
          notes: parsed.description,
          event_source_ref: eventSourceRefForIrrfOpcaoMensal(ym),
          extract_category: 1,
          applies_to_b3: false,
        });
        continue;
      }

      // Fallback: agrupa por mes em BTG-IRRF-OPCAO-MENSAL:{ym} como header de cash_movement em CAIXA.
      out.push({
        date: parsed.date,
        ticker: map.ticker, // MAIN_CASH_TICKER
        operation: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: Math.round(net * 100) / 100,
        asset_type: map.asset_type,
        notes: map.notes ?? parsed.description,
        event_source_ref: eventSourceRefForIrrfOpcaoMensal(ym),
        extract_category: 1,
      });
      continue;
    }

    // Caso 1D — qualquer despesa BTC PRIO3 (corretagem, IR, taxa, remuneracao):
    // todas caem em 1 header mensal. Remuneracao positiva continua sendo
    // securities_lending (income); demais viram cost_adjustment em PRIO3.
    if (BTC_PRIO3_DESC_RE.test(upperDesc)) {
      const ref = eventSourceRefForBtcPrio3(ym);
      const isIncome = upperDesc.includes('REMUNERA') && parsed.signedCash >= 0;
      if (isIncome) {
        // Remuneracao de aluguel: income do caixa, agrupado no header mensal BTC.
        out.push({
          date: parsed.date,
          ticker: map.ticker,
          operation: 'securities_lending',
          quantity: 0,
          unit_price: 0,
          total_net_value: Math.round(net * 100) / 100,
          asset_type: map.asset_type,
          underlying_ticker: map.underlying_ticker ?? 'PRIO3',
          notes: map.notes ?? parsed.description,
          event_source_ref: ref,
          extract_category: 1,
        });
      } else {
        // Despesa BTC (corretagem aluguel, IR retido sobre remuneracao):
        // cost_adjustment em PRIO3.
        out.push({
          date: parsed.date,
          ticker: 'PRIO3',
          operation: 'cost_adjustment',
          quantity: 0,
          unit_price: Math.abs(parsed.movementAmount),
          total_net_value: Math.abs(parsed.movementAmount),
          asset_type: 'stock',
          underlying_ticker: 'PRIO3',
          notes: parsed.description,
          event_source_ref: ref,
          extract_category: 1,
          applies_to_b3: false,
        });
      }
      continue;
    }

    // Caso 2 — custodia/taxa generica: pareia cobranca+estorno antes de ratear.
    if (
      map.operation === 'fee' &&
      IS_GENERIC_CUSTODY_RE.test(parsed.description) &&
      !TAXA_TD_DESC_RE.test(upperDesc)
    ) {
      pendingCustody.push({
        date: parsed.date,
        description: parsed.description,
        movementAmount: parsed.movementAmount,
        expenseAmount: resolveExtractLineExpenseAmount(parsed, line),
        signedNet: Math.round(net * 100) / 100,
        ym,
      });
      continue;
    }

    // Caso 3 — multa/juros saldo negativo: header avulso por padrao, ou rateado via resolver.
    if (NEG_PENALTY_RE.test(upperDesc)) {
      const allocation = resolvers?.resolveNegativeBalanceAllocation?.(parsed.date);
      if (allocation && allocation.length > 0) {
        pushWeightedCostAdjustments(
          out,
          parsed,
          allocation,
          resolveExtractLineExpenseAmount(parsed, line),
          { notesPrefix: 'Rateio juros/multa:' }
        );
        continue;
      }

      // Fallback
      out.push({
        date: parsed.date,
        ticker: map.ticker,
        operation: 'penalty_b3',
        quantity: 0,
        unit_price: 0,
        total_net_value: Math.round(net * 100) / 100,
        asset_type: map.asset_type,
        notes: map.notes ?? parsed.description,
        extract_category: 3,
      });
      continue;
    }

    // Caso 3 — TED, rendimento, capital_*, demais: 1 header avulso por linha.
    const qty =
      map.operation === 'buy' || map.operation === 'sell'
        ? Math.abs(parsed.movementAmount)
        : 0;

    out.push({
      date: parsed.date,
      ticker: map.ticker,
      operation: map.operation,
      quantity: qty,
      unit_price: qty > 0 ? 1 : 0,
      total_net_value: Math.round(net * 100) / 100,
      asset_type: map.asset_type,
      underlying_ticker: map.underlying_ticker,
      notes: map.notes ?? parsed.description,
      extract_category: 3,
    });
  }

  const { netZero: custodyNetZero, unmatched: custodyUnmatched } =
    splitNetZeroCustodyMoves(pendingCustody);
  out.push(...custodyNetZero);
  for (const move of custodyUnmatched) {
    const ref = eventSourceRefForCustodiaMensal(move.ym);
    if (move.signedNet < 0) {
      const allocation = resolvers?.resolveCustodyFeeAllocation?.(move.date);
      if (allocation?.length) {
        pushWeightedCostAdjustments(
          out,
          { date: move.date, description: move.description },
          allocation,
          move.expenseAmount ?? Math.abs(move.movementAmount),
          {
            event_source_ref: ref,
            notesPrefix: 'Rateio custodia:',
          }
        );
        continue;
      }
    }

    out.push({
      date: move.date,
      ticker: CASH_TICKER,
      operation: 'fee',
      quantity: 0,
      unit_price: 0,
      total_net_value: move.signedNet,
      asset_type: 'cash',
      notes: move.description,
      event_source_ref: ref,
      extract_category: 2,
    });
  }

  return dedupeLiqBolsaExtractEntries(netZeroCustodyFeePairs(out));
}

/** PDF BTG pode repetir a mesma linha LIQ BOLSA — dedup por data+valor. */
export function dedupeLiqBolsaExtractEntries(entries: BtgExtractEntry[]): BtgExtractEntry[] {
  const seen = new Set<string>();
  const out: BtgExtractEntry[] = [];
  for (const entry of entries) {
    const isLiq =
      entry.operation === 'pending_settlement' && /LIQ\s+BOLSA/i.test(String(entry.notes || ''));
    if (!isLiq) {
      out.push(entry);
      continue;
    }
    const key = `${entry.date}|${Math.round(Number(entry.total_net_value ?? 0) * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
