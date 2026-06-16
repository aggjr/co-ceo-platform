/**
 * Translator do formato "carteira atualizada" do home broker BTG para o schema
 * canonico de snapshot de custodia (`BrokerCustodySnapshotInput`).
 *
 * Formato de origem (export do home broker):
 *   {
 *     data_referencia: "2026-06-05",
 *     patrimonio: { total, renda_variavel:{valor}, renda_fixa:{valor},
 *                   conta_investimento:{valor}, valores_em_transito:{valor},
 *                   derivativos:{valor} },
 *     acoes:  { ativos:   [{ ticker, quantidade, preco_mercado, saldo_bruto }] },
 *     opcoes: { posicoes: [{ codigo, quantidade, premio_atual, premio_medio,
 *                            valor_mercado }] }
 *   }
 *
 * Saida: objeto no formato bruto aceito por `parseBrokerCustodySnapshotJson`
 * (schemaVersion 1, composition, positions[] com lineKind 'mark'), que valida e
 * normaliza antes de seguir para `upsertFromInput` -> `applyBrokerHoldingSnapshot`.
 *
 * Uso exclusivo de carga inicial: alimenta cotacoes/posicoes/ancoras a partir do
 * fechamento do home broker. Movimentacao transacional vem das notas de corretagem
 * (btgBrokerageNoteLedgerTranslator), nao deste snapshot.
 */

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function componentValue(patrimonio: Record<string, unknown>, key: string): number {
  const node = patrimonio[key];
  if (node && typeof node === 'object') {
    const v = numberOrNull((node as Record<string, unknown>).valor);
    if (v != null) return v;
  }
  const flat = numberOrNull(node);
  return flat ?? 0;
}

/** Heuristica leve: identifica o export "carteira atualizada" do home broker. */
export function isHomeBrokerPortfolioSnapshot(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const doc = raw as Record<string, unknown>;
  const hasPatrimonio = doc.patrimonio != null && typeof doc.patrimonio === 'object';
  const hasHoldings = doc.acoes != null || doc.opcoes != null;
  const hasDate = doc.data_referencia != null || doc.referenceDate != null;
  return hasPatrimonio && hasHoldings && hasDate;
}

type CanonicalSnapshotRaw = {
  schemaVersion: 1;
  broker: string;
  referenceDate: string;
  sourceLabel: string;
  notes: string;
  composition: {
    variableIncome: number;
    fixedIncome: number;
    cash: number;
    inTransit: number;
    derivatives: number;
    totalPatrimony: number;
  };
  positions: Array<{
    ticker: string;
    lineKind: 'mark';
    quantity: number;
    lastPrice: number;
    marketValue: number;
  }>;
};

/**
 * Converte o export do home broker no objeto bruto canonico. Nao persiste nada;
 * o resultado deve passar por `parseBrokerCustodySnapshotJson` para validacao.
 */
export function translateHomeBrokerPortfolioSnapshot(raw: unknown): CanonicalSnapshotRaw {
  if (!isHomeBrokerPortfolioSnapshot(raw)) {
    throw new Error('JSON nao reconhecido como carteira atualizada do home broker.');
  }
  const doc = raw as Record<string, unknown>;

  const referenceDate = String(doc.data_referencia ?? doc.referenceDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    throw new Error('carteira atualizada: data_referencia obrigatoria (YYYY-MM-DD).');
  }

  const patrimonio = (doc.patrimonio as Record<string, unknown>) ?? {};
  const composition = {
    variableIncome: componentValue(patrimonio, 'renda_variavel'),
    fixedIncome: componentValue(patrimonio, 'renda_fixa'),
    cash: componentValue(patrimonio, 'conta_investimento'),
    inTransit: componentValue(patrimonio, 'valores_em_transito'),
    derivatives: componentValue(patrimonio, 'derivativos'),
    totalPatrimony: numberOrNull(patrimonio.total) ?? 0,
  };

  const positions: CanonicalSnapshotRaw['positions'] = [];

  const acoes = doc.acoes as Record<string, unknown> | undefined;
  const ativos = Array.isArray(acoes?.ativos) ? (acoes!.ativos as unknown[]) : [];
  for (const item of ativos) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const ticker = String(row.ticker ?? '').trim().toUpperCase();
    const quantity = numberOrNull(row.quantidade);
    const lastPrice = numberOrNull(row.preco_mercado);
    const marketValue = numberOrNull(row.saldo_bruto);
    if (!ticker || quantity == null || lastPrice == null || marketValue == null) continue;
    positions.push({ ticker, lineKind: 'mark', quantity, lastPrice, marketValue });
  }

  const opcoes = doc.opcoes as Record<string, unknown> | undefined;
  const posicoes = Array.isArray(opcoes?.posicoes) ? (opcoes!.posicoes as unknown[]) : [];
  for (const item of posicoes) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const ticker = String(row.codigo ?? row.ticker ?? '').trim().toUpperCase();
    const quantity = numberOrNull(row.quantidade);
    const marketValue = numberOrNull(row.valor_mercado);
    if (!ticker || quantity == null || marketValue == null) continue;
    // mark exige lastPrice > 0; premio_atual pode ser 0 em opcao virando po, entao
    // recai para premio_medio ou para o premio implicito |valor_mercado/quantidade|.
    let lastPrice = numberOrNull(row.premio_atual) ?? 0;
    if (lastPrice <= 0) lastPrice = numberOrNull(row.premio_medio) ?? 0;
    if (lastPrice <= 0 && quantity !== 0) lastPrice = Math.abs(marketValue / quantity);
    if (lastPrice <= 0) continue;
    positions.push({
      ticker,
      lineKind: 'mark',
      quantity,
      lastPrice: Math.round(lastPrice * 10000) / 10000,
      marketValue,
    });
  }

  return {
    schemaVersion: 1,
    broker: 'btg',
    referenceDate,
    sourceLabel: 'Home broker — carteira atualizada',
    notes: 'Carga inicial: snapshot de carteira do home broker (acoes + opcoes + composicao).',
    composition,
    positions,
  };
}
