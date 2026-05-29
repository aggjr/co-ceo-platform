import type { LedgerEvent } from './CustodyEngine';
import { inferUnderlyingTicker } from './assetClassifier';
import {
  computeThreePricesByUnderlying,
  type ThreePrices,
} from './threePricesEngine';

const QTY_EPS = 1e-6;

export type ThreeAvgPrices = {
  strict: number;
  b3: number;
  managerial: number;
};

/** PM da ação mãe nos três modos (gerencial só com opções do lote aberto atual). */
export function buildThreeAvgPricesByUnderlying(
  entries: LedgerEvent[]
): Map<string, ThreeAvgPrices> {
  const result = computeThreePricesByUnderlying(entries);
  const out = new Map<string, ThreeAvgPrices>();
  for (const [u, p] of result) {
    out.set(u, { strict: p.estrito, b3: p.b3, managerial: p.gerencial });
  }
  return out;
}

/**
 * Data em que o lote atual da ação mãe foi aberto (última vez que qty passou de 0 para >0).
 */
export function computeLotStartDates(entries: LedgerEvent[]): Map<string, string> {
  const result = computeThreePricesByUnderlying(entries);
  const out = new Map<string, string>();
  for (const [u, p] of result) {
    if (p.lotStart) out.set(u, p.lotStart);
  }
  return out;
}

function hasPositivePm(p: ThreeAvgPrices | null | undefined): boolean {
  if (!p) return false;
  return p.strict > 0 || p.b3 > 0 || p.managerial > 0;
}

function pmFromExtRow(row: Record<string, unknown>): ThreeAvgPrices | null {
  const strict =
    row.pm_estrito != null ? Number(row.pm_estrito) : null;
  const b3 = row.pm_b3 != null ? Number(row.pm_b3) : null;
  const ger = row.pm_gerencial != null ? Number(row.pm_gerencial) : null;
  if (strict == null || strict <= 0) return null;
  return {
    strict,
    b3: b3 != null && b3 > 0 ? b3 : strict,
    managerial: ger != null && ger > 0 ? ger : strict,
  };
}

function impliedPmFromCustodyRow(row: Record<string, unknown>): number {
  const qty = Math.abs(Number(row.current_quantity ?? 0));
  if (qty <= QTY_EPS) return 0;
  const acq = Number(row.acquisition_value ?? 0);
  if (acq > 0) return acq / qty;
  const avg = Number(row.managerial_avg_price ?? 0);
  return avg > 0 ? avg : 0;
}

/** Resolve PM triplo para uma linha de custódia (ação ou opção com underlying). */
export function resolveThreePricesForAsset(
  assetTicker: string,
  assetType: string,
  underlyingFromMeta: string | undefined,
  priceMap: Map<string, ThreeAvgPrices>,
  custodyAvgPrice: number
): ThreeAvgPrices {
  const isOption =
    assetType === 'option_call' ||
    assetType === 'option_put' ||
    assetType === 'option';

  if (isOption) {
    return {
      strict: custodyAvgPrice,
      b3: custodyAvgPrice,
      managerial: custodyAvgPrice,
    };
  }

  const und = inferUnderlyingTicker(assetTicker, underlyingFromMeta);
  const hit = priceMap.get(und);
  if (hasPositivePm(hit)) return hit!;

  const fallback = custodyAvgPrice > 0 ? custodyAvgPrice : 0;
  return { strict: fallback, b3: fallback, managerial: fallback };
}

/**
 * PM triplo para tela de ações/FIIs: engine → ext → custódia (acquisition/qty).
 */
export function resolveEquityThreePricesForPortfolioRow(
  row: Record<string, unknown>,
  priceMap: Map<string, ThreeAvgPrices>,
  engineSnapshots: Map<string, ThreePrices>
): ThreeAvgPrices {
  const ticker = String(row.asset_ticker ?? '').trim().toUpperCase();
  const assetType = String(row.asset_type ?? '');
  const und = inferUnderlyingTicker(
    ticker,
    row.underlying_ticker != null
      ? String(row.underlying_ticker)
      : undefined
  );

  const eng = engineSnapshots.get(und) ?? engineSnapshots.get(ticker);
  if (eng && eng.qty > QTY_EPS && eng.estrito > 0) {
    return {
      strict: eng.estrito,
      b3: eng.b3 > 0 ? eng.b3 : eng.estrito,
      managerial: eng.gerencial > 0 ? eng.gerencial : eng.estrito,
    };
  }

  const fromMap = priceMap.get(und);
  if (hasPositivePm(fromMap)) return fromMap!;

  const fromExt = pmFromExtRow(row);
  if (fromExt) return fromExt;

  const implied = impliedPmFromCustodyRow(row);
  if (implied > 0) {
    return { strict: implied, b3: implied, managerial: implied };
  }

  return resolveThreePricesForAsset(
    ticker,
    assetType,
    und !== ticker ? und : undefined,
    priceMap,
    Number(row.managerial_avg_price ?? 0)
  );
}

export type { ThreePrices };
