/** Ticker canônico — Tesouro Selic 2031 (LFT). */
export const TESOURO_SELIC_2031_TICKER = 'TESOURO-SELIC-2031';

export function isTesouroDiretoTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t.startsWith('LFT-') || t.startsWith('TESOURO-') || t.startsWith('TD-');
}

export function canonicalTesouroTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (isTesouroDiretoTicker(t)) return TESOURO_SELIC_2031_TICKER;
  return t;
}

/** PU aproximado (R$/título) para converter extrato BTG (valor em R$) em quantidade de títulos. */
export function estimateTesouroPu(date?: string | null): number {
  const d = String(date ?? '').slice(0, 10);
  if (d >= '2026-05-01') return 18774.21;
  if (d >= '2026-01-01') return 18350;
  if (d >= '2025-01-01') return 17236;
  return 15000;
}

/**
 * Extrato BTG: quantity = valor financeiro (R$), unit_price = 1.
 * MyProfit / saldo inicial: quantity = nº de títulos, unit_price = PU.
 */
export function normalizeTesouroLedgerQuantity(line: {
  quantity: number;
  unit_price: number;
  total_net_value?: number | null;
  date?: string | null;
}): { quantity: number; unit_price: number } {
  const rawQty = Math.abs(Number(line.quantity));
  const rawPrice = Number(line.unit_price);
  const net = Math.abs(Number(line.total_net_value ?? 0));
  const brl = net > 0 ? net : rawQty;

  if (rawQty <= 0) return { quantity: 0, unit_price: rawPrice };

  if (rawPrice > 50) {
    return { quantity: rawQty, unit_price: rawPrice };
  }

  if (rawQty <= 500 && rawPrice <= 1.01) {
    const pu = rawQty > 0 && brl > 0 ? brl / rawQty : estimateTesouroPu(line.date);
    return { quantity: rawQty, unit_price: pu > 50 ? pu : estimateTesouroPu(line.date) };
  }

  const pu = estimateTesouroPu(line.date);
  return { quantity: brl / pu, unit_price: pu };
}
