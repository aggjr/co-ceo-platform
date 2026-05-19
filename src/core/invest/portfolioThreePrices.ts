import type { LedgerEvent } from './CustodyEngine';
import { inferUnderlyingTicker } from './assetClassifier';
import {
  avgPrice,
  computePricesByUnderlying,
  isOptionLedgerEvent,
  type UnderlyingPriceState,
} from './ManagerialPriceEngine';

export type ThreeAvgPrices = {
  strict: number;
  b3: number;
  managerial: number;
};

/** PM da ação mãe nos três modos (gerencial só com opções do lote aberto atual). */
export function buildThreeAvgPricesByUnderlying(
  entries: LedgerEvent[]
): Map<string, ThreeAvgPrices> {
  const sorted = sortLedgerByDate(entries);
  const lotStarts = computeLotStartDates(sorted);
  const managerialEntries = filterLedgerForManagerialPrice(sorted, lotStarts);

  const strictMap = computePricesByUnderlying(sorted, 'strict');
  const b3Map = computePricesByUnderlying(sorted, 'b3');
  const mgrMap = computePricesByUnderlying(managerialEntries, 'managerial');

  const keys = new Set<string>([
    ...strictMap.keys(),
    ...b3Map.keys(),
    ...mgrMap.keys(),
  ]);

  const out = new Map<string, ThreeAvgPrices>();
  for (const u of keys) {
    const s = strictMap.get(u) ?? empty(u);
    const b = b3Map.get(u) ?? empty(u);
    const m = mgrMap.get(u) ?? empty(u);
    out.set(u, {
      strict: round4(avgPrice(s, 'strict')),
      b3: round4(avgPrice(b, 'b3')),
      managerial: round4(avgPrice(m, 'managerial')),
    });
  }
  return out;
}

function sortLedgerByDate(entries: LedgerEvent[]): LedgerEvent[] {
  return [...entries].sort((a, b) => {
    const da = String(a.transaction_date ?? '');
    const db = String(b.transaction_date ?? '');
    if (da !== db) return da.localeCompare(db);
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

/**
 * Data em que o lote atual da ação mãe foi aberto (última vez que qty passou de ≤0 para >0).
 */
export function computeLotStartDates(entries: LedgerEvent[]): Map<string, string> {
  const qtyByUnderlying = new Map<string, number>();
  const lotStart = new Map<string, string>();

  for (const e of entries) {
    if (isOptionLedgerEvent(e)) continue;
    const type = String(e.transaction_type);
    if (!['buy', 'sell', 'opening_balance', 'bonus', 'option_exercise'].includes(type)) {
      continue;
    }
    const und = inferUnderlyingTicker(
      String(e.asset_ticker),
      e.underlying_ticker ? String(e.underlying_ticker) : undefined
    );
    const prev = qtyByUnderlying.get(und) ?? 0;
    let next = prev;
    const q = Math.abs(Number(e.quantity));

    if (['buy', 'opening_balance', 'bonus'].includes(type)) {
      next = prev + q;
    } else if (type === 'sell' || type === 'option_exercise') {
      next = Math.max(0, prev - q);
    }

    if (prev <= 0 && next > 0) {
      lotStart.set(und, String(e.transaction_date ?? ''));
    }
    qtyByUnderlying.set(und, next);
  }

  return lotStart;
}

/** Opções anteriores ao lote aberto não entram no PM gerencial. */
export function filterLedgerForManagerialPrice(
  entries: LedgerEvent[],
  lotStarts: Map<string, string>
): LedgerEvent[] {
  return entries.filter((e) => {
    if (!isOptionLedgerEvent(e)) return true;

    const und = inferUnderlyingTicker(
      String(e.asset_ticker),
      e.underlying_ticker ? String(e.underlying_ticker) : undefined
    );
    const lotStart = lotStarts.get(und);
    if (!lotStart) return false;

    if (e.impacts_managerial_price === false || e.impacts_managerial_price === 0) {
      return false;
    }

    const d = String(e.transaction_date ?? '');
    return d >= lotStart;
  });
}

function empty(underlying: string): UnderlyingPriceState {
  return {
    underlying,
    quantity: 0,
    strictCostTotal: 0,
    b3CostTotal: 0,
    managerialCostTotal: 0,
    optionAdjustmentManagerial: 0,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
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
