import { buildStoredTwrChartSeries } from '../../../src/core/invest/storedPatrimonyChart';
import type { StoredPortfolioDay } from '../../../src/core/invest/PatrimonyDailyStore';

function day(date: string, cum: number, daily: number | null = 0.01): StoredPortfolioDay {
  return {
    id: `id-${date}`,
    organization_id: 'org-holding-001',
    snapshot_date: date,
    patrimony: 1_000_000,
    patrimony_gross: 1_000_000,
    cash: 0,
    positions_value: 1_000_000,
    pending_settlements: 0,
    fixed_income_total: 0,
    external_flow: 0,
    daily_return_simple: daily,
    daily_return_twr: daily,
    cumulative_twr: cum,
    quotes_as_of: date,
    source: 'mtm_economic',
    metadata: null,
  };
}

describe('buildStoredTwrChartSeries', () => {
  it('rebaseia TWR acumulado no início do período', () => {
    const stored = [day('2026-01-01', 0), day('2026-01-02', 0.01), day('2026-01-03', 0.03)];
    const chart = buildStoredTwrChartSeries(stored, ['2026-01-01', '2026-01-02', '2026-01-03'], '2026-01-01');
    expect(chart[0]!.periodReturnToDate).toBe(0);
    expect(chart[chart.length - 1]!.periodReturnToDate).toBeCloseTo(0.03, 3);
  });
});
