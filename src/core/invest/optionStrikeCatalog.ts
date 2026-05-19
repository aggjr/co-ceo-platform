/**
 * Strikes reais (myProfit / BTG) — o sufixo do ticker B3 não é o strike.
 * Atualize aqui ou via POST /api/invest/options/snapshot.
 */
export const OPTION_STRIKE_CATALOG: Readonly<Record<string, number>> = {
  ITUBR416: 37.9,
  WEGER41: 41.0,
  WEGER448: 42.47,
  PRIOR407: 40.75,
  PRIOR560: 56,
  PRIOR580: 58,
  PRIOR590: 59,
  PRIOR605: 60.5,
  PRIOF740: 74,
  PRIOF750: 75,
  PRIOF760: 76,
  PRIOF780: 78,
};

export function strikeFromCatalog(ticker: string): number | null {
  const key = ticker.trim().toUpperCase();
  const raw = OPTION_STRIKE_CATALOG[key];
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10000) / 10000;
}

/** Payload para snapshot de opções (strikes + últimos do Profit). */
export function catalogSnapshotItems(
  asOf = new Date().toISOString().slice(0, 10)
): Array<{ ticker: string; option_strike: number }> {
  return Object.entries(OPTION_STRIKE_CATALOG).map(([ticker, option_strike]) => ({
    ticker,
    option_strike,
    asOf,
  }));
}
