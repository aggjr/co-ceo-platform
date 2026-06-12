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

  if (chartSeriesHasVariation(fromStored)) return fromStored;
  if (chartSeriesHasVariation(fromPerformance)) return fromPerformance;
  if (fromStored.length >= 2) return fromStored;
  if (fromPerformance.length >= 2) return fromPerformance;
  return fromPatrimony;
}

/** Patrimônio em R$ só dos dias gravados (para mesclar com série calculada). */
export function storedPatrimonyByDate(
  stored: StoredPortfolioDay[]
): Map<string, number> {
  return new Map(stored.map((s) => [s.snapshot_date, s.patrimony]));
}
