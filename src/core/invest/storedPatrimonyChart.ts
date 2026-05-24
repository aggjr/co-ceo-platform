import type { BenchmarkChartPoint } from '../market/indexBenchmark';
import type { StoredPortfolioDay } from './PatrimonyDailyStore';

/**
 * Curva TWR a partir de fechamentos gravados (invest_portfolio_daily.cumulative_twr).
 * Rebasa no primeiro dia do período com dado gravado — mesma ideia do índice PRIO (série diária real).
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

  return alignDates.map((date) => {
    const row = byDate.get(date.slice(0, 10));
    if (!row || row.cumulative_twr == null) {
      return {
        date: date.slice(0, 10),
        indexedLevel: 100,
        periodReturnToDate: 0,
        dailyFactor: row?.daily_return_twr ?? null,
      };
    }
    const relFactor = (1 + row.cumulative_twr) / baseFactor;
    const periodReturnToDate = Math.round((relFactor - 1) * 1_000_000) / 1_000_000;
    const indexedLevel = Math.round(100 * relFactor * 1_000_000) / 1_000_000;
    return {
      date: date.slice(0, 10),
      indexedLevel,
      periodReturnToDate,
      dailyFactor: row.daily_return_twr,
    };
  });
}

/** Patrimônio em R$ só dos dias gravados (para mesclar com série calculada). */
export function storedPatrimonyByDate(
  stored: StoredPortfolioDay[]
): Map<string, number> {
  return new Map(stored.map((s) => [s.snapshot_date, s.patrimony]));
}
