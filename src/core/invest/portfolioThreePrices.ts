import type { LedgerEvent } from './CustodyEngine';
import { inferUnderlyingTicker } from './assetClassifier';
import {
  computeThreePricesByUnderlying,
  type ThreePrices,
} from './threePricesEngine';

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
  if (hit) return hit;

  const fallback = custodyAvgPrice;
  return { strict: fallback, b3: fallback, managerial: fallback };
}

export type { ThreePrices };
