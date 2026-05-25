import {
  inferAssetType,
  inferUnderlyingTicker,
  isOptionTicker,
} from './assetClassifier';
import type { AssetCustodyState } from './CustodyEngine';
import type { LedgerEvent } from './CustodyEngine';
import { inferOptionMonthFromTicker } from './optionExpiry';

export { inferOptionMonthFromTicker };

export type CallCoverageOptionRow = {
  ticker?: string;
  underlying?: string;
  quantity: number;
  optionSide?: string | null;
  assetType?: string;
};

/** Quantidade absoluta de opções (livro razão guarda CALL vendida com sinal negativo). */
export function optionQtyAbs(quantity: number): number {
  const abs = Math.abs(Number(quantity));
  return Number.isFinite(abs) ? abs : 0;
}

/** Capacidade de cobertura: cada ação cobre uma CALL vendida. */
export function equityCallCoverageCapacity(shareQty: number): number {
  const q = Number(shareQty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  return q;
}

/** B3: 5ª letra A–L = CALL; M–X = PUT. */
export function resolveOptionSide(
  opt: Pick<CallCoverageOptionRow, 'ticker' | 'optionSide' | 'assetType'>
): 'call' | 'put' | null {
  if (opt.optionSide === 'call' || opt.assetType === 'option_call') return 'call';
  if (opt.optionSide === 'put' || opt.assetType === 'option_put') return 'put';
  const info = inferOptionMonthFromTicker(String(opt.ticker || ''));
  return info?.optionSide ?? null;
}

export function formatOptionTypeLabel(side: 'call' | 'put' | null): string {
  if (side === 'call') return 'CALL';
  if (side === 'put') return 'PUT';
  return '—';
}

function isShortCallPosition(opt: CallCoverageOptionRow): boolean {
  if (Number(opt.quantity) >= -1e-9) return false;
  return resolveOptionSide(opt) === 'call';
}

/** Ação-mãe canônica (livro às vezes grava o ticker da opção em underlying_ticker). */
export function resolveCoverageUnderlying(
  ticker: string,
  underlying?: string | null
): string {
  const t = String(ticker || '').trim().toUpperCase();
  const u = String(underlying || '').trim().toUpperCase();
  if (u && u !== t && !isOptionTicker(u)) return u;
  return inferUnderlyingTicker(t);
}

/** Soma CALLs vendidas (unidades) por ação objeto. */
export function buildShortCallsSoldByUnderlying(
  options: CallCoverageOptionRow[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const opt of options || []) {
    if (!isShortCallPosition(opt)) continue;
    const u = resolveCoverageUnderlying(opt.ticker || '', opt.underlying);
    if (!u) continue;
    const units = optionQtyAbs(opt.quantity);
    map.set(u, (map.get(u) || 0) + units);
  }
  return map;
}

export function sumShortCallQtyAbs(
  options: CallCoverageOptionRow[] | null | undefined
): number {
  let total = 0;
  for (const opt of options || []) {
    if (!isShortCallPosition(opt)) continue;
    total += optionQtyAbs(opt.quantity);
  }
  return Math.round(total * 100) / 100;
}

export type CallCoverageEquityRow = {
  ticker?: string;
  assetType?: string;
  quantity: number;
  callsSold?: number | null;
  callsRemaining?: number | null;
};

function isOptionLikeEquity(row: CallCoverageEquityRow): boolean {
  const t = String(row.ticker || '');
  return (
    row.assetType === 'option_call' ||
    row.assetType === 'option_put' ||
    /^[A-Z]{4}[A-X]\d/i.test(t)
  );
}

function isPortfolioOptionRow(item: {
  ticker?: string;
  assetType?: string;
}): boolean {
  const t = String(item.ticker || '').toUpperCase();
  const at = String(item.assetType || '');
  return at === 'option_call' || at === 'option_put' || isOptionTicker(t);
}

/** Posições curtas CALL: planilha de opções + custódia recalculada do livro-razão. */
export function collectCallCoverageOptionRows(
  portfolioItems: Array<{
    ticker?: string;
    underlying?: string;
    quantity: number;
    assetType?: string;
    optionSide?: string | null;
  }>,
  ledgerAssets: AssetCustodyState[] | null | undefined
): CallCoverageOptionRow[] {
  const byTicker = new Map<string, CallCoverageOptionRow>();

  const add = (row: CallCoverageOptionRow) => {
    const t = String(row.ticker || '').toUpperCase();
    if (!t) return;
    const prev = byTicker.get(t);
    if (!prev || optionQtyAbs(row.quantity) >= optionQtyAbs(prev.quantity)) {
      byTicker.set(t, row);
    }
  };

  for (const item of portfolioItems || []) {
    if (!isPortfolioOptionRow(item)) continue;
    add({
      ticker: item.ticker,
      underlying: resolveCoverageUnderlying(item.ticker || '', item.underlying),
      quantity: item.quantity,
      assetType: item.assetType,
      optionSide: item.optionSide ?? null,
    });
  }

  for (const la of ledgerAssets || []) {
    if (Number(la.quantity) >= -1e-9) continue;
    const side = resolveOptionSide({
      ticker: la.ticker,
      assetType: la.assetType,
    });
    if (side !== 'call') continue;
    add({
      ticker: la.ticker,
      underlying: resolveCoverageUnderlying(la.ticker, la.underlying),
      quantity: la.quantity,
      assetType: la.assetType || inferAssetType(la.ticker),
      optionSide: 'call',
    });
  }

  return [...byTicker.values()];
}

/** Prêmio de call_sell no livro (crédito D+1 na conta). */
export function buildShortCallPremiumPendingByUnderlying(
  events: LedgerEvent[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events || []) {
    if (String(e.transaction_type) !== 'call_sell') continue;
    const side = resolveOptionSide({
      ticker: e.asset_ticker,
      assetType: e.asset_type,
    });
    if (side !== 'call') continue;
    const u = resolveCoverageUnderlying(
      e.asset_ticker,
      e.underlying_ticker
    );
    const net = Math.abs(Number(e.total_net_value ?? 0));
    const gross =
      net > 0 ? net : Math.abs(Number(e.quantity)) * Math.abs(Number(e.unit_price));
    if (gross <= 0) continue;
    map.set(u, Math.round(((map.get(u) || 0) + gross) * 100) / 100);
  }
  return map;
}

export type CallCoverageEquityRowExtended = CallCoverageEquityRow & {
  callsPremiumPending?: number | null;
};

/** Enriquece linhas de ações/FIIs com cobertura de CALL vendida. */
export function attachCallCoverageToEquities<
  T extends CallCoverageEquityRowExtended,
>(
  equities: T[] | null | undefined,
  options: CallCoverageOptionRow[] | null | undefined,
  premiumByUnderlying?: Map<string, number> | null
): T[] {
  const soldMap = buildShortCallsSoldByUnderlying(options);
  return (equities || []).map((row) => {
    const isEquity =
      row.assetType === 'stock' ||
      row.assetType === 'fii' ||
      (!isOptionLikeEquity(row) &&
        row.assetType !== 'fixed_income' &&
        row.assetType !== 'cash');
    if (!isEquity) {
      return { ...row, callsSold: null, callsRemaining: null, callsPremiumPending: null };
    }
    const key = String(row.ticker || '').toUpperCase();
    const fromOptions = soldMap.get(key) || 0;
    const fromApi = Number(row.callsSold);
    const sold = Math.round(
      Math.max(fromOptions, Number.isFinite(fromApi) ? fromApi : 0) * 100
    ) / 100;
    const capacity = equityCallCoverageCapacity(row.quantity);
    const remaining = Math.round((capacity - sold) * 100) / 100;
    const pending = premiumByUnderlying?.get(key);
    return {
      ...row,
      callsSold: sold,
      callsRemaining: remaining,
      callsPremiumPending:
        pending != null && pending > 0 ? pending : row.callsPremiumPending ?? null,
    };
  });
}
