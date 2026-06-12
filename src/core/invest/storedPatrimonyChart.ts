import type { BenchmarkChartPoint } from '../market/indexBenchmark';
import {
  buildPatrimonyIndexedSeries,
  buildTwrPerformanceChartSeries,
} from '../market/indexBenchmark';
import type { StoredPortfolioDay } from './PatrimonyDailyStore';

function chartSeriesHasVariation(series: BenchmarkChartPoint[]): boolean {
  if (series.length < 2) return false;
  const levels = series.map((p) => Number(p.indexedLevel ?? 100));
  return Math.max(...levels) - Math.min(...levels) > 0.0001;
}

function daySerial(date: string): number {
  return Math.round(new Date(`${date.slice(0, 10)}T12:00:00Z`).getTime() / 86_400_000);
}

function roundedChartPoint(
  date: string,
  cumulativeTwr: number,
  baseFactor: number,
  dailyFactor: number | null | undefined
): BenchmarkChartPoint {
  const relFactor = (1 + cumulativeTwr) / baseFactor;
  return {
    date,
    indexedLevel: Math.round(100 * relFactor * 1_000_000) / 1_000_000,
    periodReturnToDate: Math.round((relFactor - 1) * 1_000_000) / 1_000_000,
    dailyFactor: dailyFactor ?? null,
  };
}

function pointWithIndexedLevel(point: BenchmarkChartPoint, indexedLevel: number): BenchmarkChartPoint {
  const roundedLevel = Math.round(indexedLevel * 1_000_000) / 1_000_000;
  return {
    ...point,
    indexedLevel: roundedLevel,
    periodReturnToDate: Math.round((roundedLevel / 100 - 1) * 1_000_000) / 1_000_000,
  };
}

function sameIndexedLevel(a: BenchmarkChartPoint, b: BenchmarkChartPoint): boolean {
  return Math.abs(Number(a.indexedLevel ?? 100) - Number(b.indexedLevel ?? 100)) < 0.000001;
}

function smoothFlatRuns(series: BenchmarkChartPoint[]): BenchmarkChartPoint[] {
  if (series.length < 3) return series;

  const out = series.map((point) => ({ ...point }));
  let i = 0;
  while (i < out.length - 2) {
    let plateauEnd = i;
    while (plateauEnd + 1 < out.length && sameIndexedLevel(out[i]!, out[plateauEnd + 1]!)) {
      plateauEnd += 1;
    }

    const nextIndex = plateauEnd + 1;
    if (plateauEnd > i && nextIndex < out.length && !sameIndexedLevel(out[i]!, out[nextIndex]!)) {
      const start = Number(out[i]!.indexedLevel ?? 100);
      const end = Number(out[nextIndex]!.indexedLevel ?? start);
      const span = nextIndex - i;
      for (let k = i + 1; k <= nextIndex; k += 1) {
        const weight = (k - i) / span;
        out[k] = pointWithIndexedLevel(out[k]!, start + (end - start) * weight);
      }
    }

    i = Math.max(i + 1, nextIndex);
  }

  return out;
}

/**
 * Curva TWR a partir de fechamentos gravados (invest_portfolio_daily.cumulative_twr).
 * Rebasa no primeiro dia do período com dado gravado — mesma ideia do índice PRIO (série diária real).
 * Dias sem fechamento gravado entre dois pontos reais são interpolados para evitar degraus artificiais.
 */
export function buildStoredTwrChartSeries(
  stored: StoredPortfolioDay[],
  alignDates: string[],
  periodFrom: string
): BenchmarkChartPoint[] {
  if (!stored.length || !alignDates.length) return [];

  const byDate = new Map(stored.map((s) => [s.snapshot_date, s]));
  const from = periodFrom.slice(0, 10);

  const known = alignDates
    .map((rawDate) => rawDate.slice(0, 10))
    .filter((date) => date >= from)
    .map((date) => {
      const row = byDate.get(date);
      return row?.cumulative_twr != null
        ? {
            date,
            cumulativeTwr: row.cumulative_twr,
            dailyFactor: row.daily_return_twr,
          }
        : null;
    })
    .filter(
      (row): row is { date: string; cumulativeTwr: number; dailyFactor: number | null } =>
        row !== null
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!known.length) return [];

  const firstKnown = known[0]!;
  const lastKnown = known[known.length - 1]!;
  const baseFactor = 1 + firstKnown.cumulativeTwr;
  const out: BenchmarkChartPoint[] = [];
  let cursor = 0;

  for (const rawDate of alignDates) {
    const date = rawDate.slice(0, 10);
    const row = byDate.get(date);
    if (row?.cumulative_twr != null) {
      out.push(roundedChartPoint(date, row.cumulative_twr, baseFactor, row.daily_return_twr));
      continue;
    }

    if (date <= firstKnown.date) {
      out.push(
        roundedChartPoint(date, firstKnown.cumulativeTwr, baseFactor, row?.daily_return_twr)
      );
      continue;
    }
    if (date >= lastKnown.date) {
      out.push(
        roundedChartPoint(date, lastKnown.cumulativeTwr, baseFactor, row?.daily_return_twr)
      );
      continue;
    }

    while (cursor < known.length - 2 && known[cursor + 1]!.date < date) {
      cursor += 1;
    }
    const prev = known[cursor]!;
    const next = known[cursor + 1]!;
    const span = daySerial(next.date) - daySerial(prev.date);
    if (span <= 0) {
      out.push(roundedChartPoint(date, prev.cumulativeTwr, baseFactor, row?.daily_return_twr));
    } else {
      const elapsed = daySerial(date) - daySerial(prev.date);
      const weight = Math.min(1, Math.max(0, elapsed / span));
      const interpolated = prev.cumulativeTwr + (next.cumulativeTwr - prev.cumulativeTwr) * weight;
      out.push(roundedChartPoint(date, interpolated, baseFactor, row?.daily_return_twr));
    }
  }

  return out;
}

/**
 * Série da carteira no gráfico: fechamentos gravados (TWR real) têm prioridade;
 * depois TWR da série mesclada; senão índice simples do patrimônio.
 */
export function resolvePortfolioIndexedForChart(
  mergedSeries: Array<{ date: string; patrimony: number }>,
  performancePoints: Array<{ date: string; cumulativeReturnTwr: number | null }> | null | undefined,
  storedTwrChart: BenchmarkChartPoint[]
): BenchmarkChartPoint[] {
  const fromPerformance =
    performancePoints && performancePoints.length >= 2
      ? buildTwrPerformanceChartSeries(performancePoints)
      : [];
  const fromStored =
    storedTwrChart.length >= 2 ? storedTwrChart : [];
  const fromPatrimony = buildPatrimonyIndexedSeries(mergedSeries);

  if (chartSeriesHasVariation(fromStored)) return smoothFlatRuns(fromStored);
  if (chartSeriesHasVariation(fromPerformance)) return smoothFlatRuns(fromPerformance);
  if (fromStored.length >= 2) return smoothFlatRuns(fromStored);
  if (fromPerformance.length >= 2) return smoothFlatRuns(fromPerformance);
  return smoothFlatRuns(fromPatrimony);
}

/** Patrimônio em R$ só dos dias gravados (para mesclar com série calculada). */
export function storedPatrimonyByDate(
  stored: StoredPortfolioDay[]
): Map<string, number> {
  return new Map(stored.map((s) => [s.snapshot_date, s.patrimony]));
}
