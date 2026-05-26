/**
 * Modelo de opções vigentes para views Cards / Vencimentos (mesma base da tabela Excel).
 */
import {
  filterOpenPortfolioItems,
  filterOptionsVencimentoAfterToday,
  formatBrl,
  formatNumber,
  formatPct,
  optionPriceReturnPct,
  resolveOptionSide,
  formatOptionTypeLabel,
} from './portfolioDisplay.js';

function resolveOptionStrike(row) {
  const s = Number(row.optionStrike);
  return Number.isFinite(s) && s > 0 ? s : null;
}

export function computeStrikeDistance(row) {
  const brl = row.strikeDistanceBrl;
  const pct = row.strikeDistancePct;
  if (brl != null && pct != null && Number.isFinite(brl) && Number.isFinite(pct)) {
    return { brl, pct };
  }
  const spot = Number(row.underlyingLastPrice);
  const strike = resolveOptionStrike(row);
  if (!Number.isFinite(spot) || strike == null || strike <= 0) return null;
  const dBrl = Math.round((spot - strike) * 100) / 100;
  const dPct = Math.round(((spot - strike) / strike) * 10000) / 100;
  return { brl: dBrl, pct: dPct };
}

/** ITM para qualquer posição (call/put). */
export function isOptionInTheMoney(row) {
  const side = resolveOptionSide(row);
  const spot = Number(row.underlyingLastPrice);
  const strike = resolveOptionStrike(row);
  if (!Number.isFinite(spot) || strike == null || strike <= 0) return false;
  if (side === 'call') return spot > strike;
  if (side === 'put') return spot < strike;
  return false;
}

/**
 * itm = dentro do dinheiro; near = até 5% do strike (fora do dinheiro); far = mais distante.
 */
export function optionMoneynessBand(row) {
  const dist = computeStrikeDistance(row);
  if (!dist) return 'unknown';
  if (isOptionInTheMoney(row)) return 'itm';
  if (Math.abs(dist.pct) <= 5) return 'near';
  return 'far';
}

export function optionPremiumTotal(row) {
  if (row.premiumReceived != null && Number.isFinite(Number(row.premiumReceived))) {
    return Number(row.premiumReceived);
  }
  const qty = Number(row.quantity);
  const pm = Number(row.avgPrice);
  if (qty < 0 && pm > 0) return Math.abs(qty) * pm;
  return 0;
}

export function optionNotionalValue(row) {
  if (row.notional != null && Number.isFinite(Number(row.notional))) {
    return Number(row.notional);
  }
  const strike = resolveOptionStrike(row);
  if (strike == null || strike <= 0) return null;
  return Math.abs(Number(row.quantity)) * strike;
}

export function prepareOpenOptionsRows(items) {
  const open = filterOpenPortfolioItems(items || []);
  return filterOptionsVencimentoAfterToday(open);
}

export function uniqueUnderlyings(rows) {
  const set = new Set();
  for (const r of rows) {
    const u = String(r.underlying || '').trim().toUpperCase();
    if (u) set.add(u);
  }
  return [...set].sort();
}

export function uniqueExpiryDates(rows) {
  const set = new Set();
  for (const r of rows) {
    const d = String(r.optionExpiryDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return [...set].sort();
}

export function uniqueExpiryDatesForUnderlying(rows, underlying) {
  const u = String(underlying || '').trim().toUpperCase();
  if (!u) return [];
  const set = new Set();
  for (const r of rows) {
    if (String(r.underlying || '').trim().toUpperCase() !== u) continue;
    const d = String(r.optionExpiryDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return [...set].sort();
}

export function filterOptionsRows(rows, filters) {
  let out = rows;
  if (filters.underlying) {
    const u = filters.underlying.toUpperCase();
    out = out.filter((r) => String(r.underlying || '').toUpperCase() === u);
  }
  if (filters.expiry) {
    out = out.filter((r) => String(r.optionExpiryDate || '').slice(0, 10) === filters.expiry);
  }
  if (filters.type === 'call') {
    out = out.filter((r) => resolveOptionSide(r) === 'call');
  } else if (filters.type === 'put') {
    out = out.filter((r) => resolveOptionSide(r) === 'put');
  }
  if (filters.band === 'itm') out = out.filter((r) => optionMoneynessBand(r) === 'itm');
  else if (filters.band === 'near') out = out.filter((r) => optionMoneynessBand(r) === 'near');
  else if (filters.band === 'far') out = out.filter((r) => optionMoneynessBand(r) === 'far');
  return out;
}

export function formatDistanceLabel(row) {
  const dist = computeStrikeDistance(row);
  if (!dist) return '—';
  const sign = dist.brl >= 0 ? '+' : '';
  const pctSign = dist.pct >= 0 ? '+' : '';
  return `${sign}${formatNumber(dist.brl, 2)} (${pctSign}${formatNumber(dist.pct, 1)}%)`;
}

export function cardFieldRows(row) {
  const dist = computeStrikeDistance(row);
  const band = optionMoneynessBand(row);
  const side = resolveOptionSide(row);
  const pnlPct = optionPriceReturnPct(row) ?? row.pnlPct;
  const distanceBrl = dist?.brl ?? null;
  return {
    ticker: row.ticker,
    underlying: row.underlying,
    typeLabel: formatOptionTypeLabel(side),
    side,
    quantity: Number(row.quantity),
    strike: resolveOptionStrike(row),
    premium: Number(row.avgPrice),
    premiumTotal: optionPremiumTotal(row),
    quote: Number(row.updatedQuote ?? row.lastPrice),
    expiry: row.optionExpiryDate,
    underlyingQuote: Number(row.underlyingLastPrice),
    distanceText: formatDistanceLabel(row),
    distanceBrl,
    distanceBand: band,
    notional: optionNotionalValue(row),
    pnl: Number(row.pnl),
    pnlPct,
    pnlFormatted: formatBrl(row.pnl),
    pnlPctFormatted: formatPct(pnlPct),
  };
}

export function groupByExpiry(rows) {
  const map = new Map();
  for (const r of rows) {
    const d = String(r.optionExpiryDate || '').slice(0, 10) || '—';
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(r);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
