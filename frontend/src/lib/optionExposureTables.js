/**
 * Tabelas de notional por faixa de distância ao strike (PUTs / CALLs), por vencimento.
 */
import { computeStrikeDistance, optionNotionalValue } from './optionPortfolioModel.js';
import { resolveOptionSide } from './portfolioDisplay.js';

function rowNotional(row) {
  const n = optionNotionalValue(row);
  return n != null && Number.isFinite(n) && n > 0 ? n : 0;
}

function distancePct(row) {
  const dist = computeStrikeDistance(row);
  return dist?.pct ?? null;
}

/**
 * Faixa incremental: itm | bandNear | bandFar | null (fora das faixas exibidas).
 * PUT: ITM = spot <= strike; "acima" = spot acima do strike (OTM put).
 * CALL: ITM = spot >= strike; "abaixo" = spot abaixo do strike (OTM call).
 */
export function classifyExposureBand(row, side, pctNear, pctFar) {
  const pct = distancePct(row);
  if (pct == null) return null;
  const near = Number(pctNear);
  const far = Number(pctFar);
  if (!Number.isFinite(near) || !Number.isFinite(far) || near <= 0 || far <= near) return null;

  if (side === 'put') {
    if (pct <= 0) return 'itm';
    if (pct > 0 && pct <= near) return 'bandNear';
    if (pct > near && pct <= far) return 'bandFar';
    return null;
  }
  if (side === 'call') {
    if (pct >= 0) return 'itm';
    if (pct < 0 && pct >= -near) return 'bandNear';
    if (pct < -near && pct >= -far) return 'bandFar';
    return null;
  }
  return null;
}

export function buildExposureByUnderlying(rows, side, pctNear, pctFar) {
  const map = new Map();

  for (const row of rows) {
    if (resolveOptionSide(row) !== side) continue;
    const underlying = String(row.underlying || '').trim().toUpperCase();
    if (!underlying) continue;

    const notional = rowNotional(row);
    if (notional <= 0) continue;

    if (!map.has(underlying)) {
      map.set(underlying, { underlying, itm: 0, bandNear: 0, bandFar: 0, total: 0 });
    }
    const agg = map.get(underlying);
    agg.total += notional;

    const band = classifyExposureBand(row, side, pctNear, pctFar);
    if (band === 'itm') agg.itm += notional;
    else if (band === 'bandNear') agg.bandNear += notional;
    else if (band === 'bandFar') agg.bandFar += notional;
  }

  const lines = [...map.values()].sort((a, b) => a.underlying.localeCompare(b.underlying));
  const totals = lines.reduce(
    (acc, line) => ({
      itm: acc.itm + line.itm,
      bandNear: acc.bandNear + line.bandNear,
      bandFar: acc.bandFar + line.bandFar,
      total: acc.total + line.total,
    }),
    { itm: 0, bandNear: 0, bandFar: 0, total: 0 },
  );

  return { lines, totals };
}
