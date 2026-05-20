/** Ações/FIIs: quantidade sempre em unidades da corretora (1 = 1 ação), nunca lote de 100. */

const EQUITY_TYPES = new Set(['stock', 'fii']);

export function isBrokerEquityAssetType(assetType: string): boolean {
  return EQUITY_TYPES.has(String(assetType || '').trim());
}

/**
 * Escolhe quantidade em unidades da corretora entre snapshot (invest_assets) e livro-razão.
 */
export function resolveBrokerShareQuantity(
  snapshotQty: number,
  ledgerQty: number,
  assetType: string
): number {
  if (!isBrokerEquityAssetType(assetType)) return ledgerQty;
  const snap = Math.abs(Number(snapshotQty));
  const led = Math.abs(Number(ledgerQty));
  if (led <= 0) return snap;
  if (snap <= 0) return normalizeLedgerEquityQuantity(led, 0).quantity;

  if (led >= snap * 0.85 && led <= snap * 1.15) return led;

  const ledScaled = led * 100;
  if (ledScaled >= snap * 0.85 && ledScaled <= snap * 1.15) return ledScaled;

  if (snap > led * 10) return snap;

  const normalized = normalizeLedgerEquityQuantity(led, 0).quantity;
  if (normalized >= snap * 0.85 && normalized <= snap * 1.15) return normalized;

  return snap >= led ? snap : normalized;
}

/**
 * Corrige custódia recalculada quando qty está em lotes (ex.: 22 em vez de 2.200).
 * Mantém custo total: avgPrice proporcional.
 */
export function normalizeLedgerEquityQuantity(
  quantity: number,
  avgPrice: number
): { quantity: number; avgPrice: number } {
  const q = Number(quantity);
  const pm = Number(avgPrice);
  if (!Number.isFinite(q) || q === 0) return { quantity: q, avgPrice: pm };

  const absQ = Math.abs(q);
  if (absQ >= 500) return { quantity: q, avgPrice: pm };

  const scaledQ = absQ * 100;
  if (scaledQ < 500) return { quantity: q, avgPrice: pm };

  const sign = q < 0 ? -1 : 1;
  return {
    quantity: sign * scaledQ,
    avgPrice: pm > 0 ? pm / 100 : pm,
  };
}

/** PM triplo incoerente com cotação (ex.: PU de Tesouro vazando em ação). */
export function sanitizeEquityThreePrices(
  assetType: string,
  prices: { strict: number; b3: number; managerial: number },
  custodyAvg: number,
  quoteRef: number
): { strict: number; b3: number; managerial: number } {
  if (!isBrokerEquityAssetType(assetType)) return prices;
  const ref =
    quoteRef > 0 && quoteRef < 2000
      ? quoteRef
      : custodyAvg > 0 && custodyAvg < 2000
        ? custodyAvg
        : 0;
  if (ref <= 0) return prices;

  const maxPm = Math.max(ref * 20, 500);
  const fix = (v: number) => (v > maxPm ? ref : v);

  return {
    strict: fix(prices.strict),
    b3: fix(prices.b3),
    managerial: fix(prices.managerial > maxPm ? custodyAvg || ref : prices.managerial),
  };
}
