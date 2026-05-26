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

/**
 * Curva TWR a partir de fechamentos gravados (invest_portfolio_daily.cumulative_twr).
 * Rebasa no primeiro dia do período com dado gravado — mesma ideia do índice PRIO (série diária real).
 * Dias sem fechamento gravado repetem o último índice conhecido (não zeram o gráfico).
 */
export function buildStoredTwrChartSeries(
  stored: StoredPortfolioDay[],
  alignDates: string[],
  periodFrom: string
): BenchmarkChartPoint[] {
  if (!stored.length || !alignDates.length) return [];

  const byDate = new Map(stored.map((s) => [s.snapshot_date, s]));
  const from = periodFrom.slice(0, 10);

  let baseCumulative: number | null = null;
  for (const date of alignDates) {
    if (date < from) continue;
    const row = byDate.get(date);
    if (row?.cumulative_twr != null) {
      baseCumulative = row.cumulative_twr;
      break;
    }
  }
  if (baseCumulative === null) return [];
  const baseFactor = 1 + baseCumulative;

  let lastPoint: BenchmarkChartPoint | null = null;
  const out: BenchmarkChartPoint[] = [];

  for (const rawDate of alignDates) {
    const date = rawDate.slice(0, 10);
    const row = byDate.get(date);
    if (row?.cumulative_twr != null) {
      const relFactor = (1 + row.cumulative_twr) / baseFactor;
      const periodReturnToDate = Math.round((relFactor - 1) * 1_000_000) / 1_000_000;
      const indexedLevel = Math.round(100 * relFactor * 1_000_000) / 1_000_000;
      lastPoint = {
        date,
        indexedLevel,
        periodReturnToDate,
        dailyFactor: row.daily_return_twr,
      };
      out.push(lastPoint);
      continue;
    }
    if (lastPoint) {
      out.push({
        date,
        indexedLevel: lastPoint.indexedLevel,
        periodReturnToDate: lastPoint.periodReturnToDate,
        dailyFactor: row?.daily_return_twr ?? null,
      });
    } else {
      out.push({
        date,
        indexedLevel: 100,
        periodReturnToDate: 0,
        dailyFactor: row?.daily_return_twr ?? null,
      });
    }
  }

  return out;
}

/**
 * Série da carteira no gráfico: TWR da série mesclada (patrimônio exibido) tem prioridade;
 * fechamentos gravados só se variarem; senão índice simples do patrimônio.
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

  if (chartSeriesHasVariation(fromPerformance)) return fromPerformance;
  if (chartSeriesHasVariation(fromStored)) return fromStored;
  if (fromPerformance.length >= 2) return fromPerformance;
  if (fromStored.length >= 2) return fromStored;
  return fromPatrimony;
}

/** Patrimônio em R$ só dos dias gravados (para mesclar com série calculada). */
export function storedPatrimonyByDate(
  stored: StoredPortfolioDay[]
): Map<string, number> {
  return new Map(stored.map((s) => [s.snapshot_date, s.patrimony]));
}
