import {
  buildStoredTwrChartSeries,
  resolvePortfolioIndexedForChart,
} from '../../../src/core/invest/storedPatrimonyChart';
import type { StoredPortfolioDay } from '../../../src/core/invest/PatrimonyDailyStore';

function storedRow(
  date: string,
  cumulative: number | null,
  daily: number | null = null
): StoredPortfolioDay {
  return {
    id: '1',
    organization_id: 'org',
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
    cumulative_twr: cumulative,
    quotes_as_of: null,
    source: 'mtm_btg_calibrated',
    metadata: null,
  };
}

describe('buildStoredTwrChartSeries', () => {
  it('interpola dias sem fechamento gravado entre dois pontos reais', () => {
    const chart = buildStoredTwrChartSeries(
      [storedRow('2026-01-02', 0), storedRow('2026-01-05', 0.05, 0.02)],
      ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
      '2026-01-02'
    );
    expect(chart[0]!.indexedLevel).toBe(100);
    expect(chart[1]!.indexedLevel).toBeCloseTo(101.6667, 4);
    expect(chart[2]!.indexedLevel).toBeCloseTo(103.3333, 4);
    expect(chart[3]!.indexedLevel).toBeCloseTo(105, 1);
  });
});

describe('resolvePortfolioIndexedForChart', () => {
  it('suaviza platô gravado seguido de salto na série exibida', () => {
    const steppedStored = buildStoredTwrChartSeries(
      [
        storedRow('2026-01-01', 0),
        storedRow('2026-01-02', 0),
        storedRow('2026-01-03', 0),
        storedRow('2026-01-04', 0.06),
      ],
      ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
      '2026-01-01'
    );
    const resolved = resolvePortfolioIndexedForChart([], null, steppedStored);
    expect(resolved[0]!.indexedLevel).toBe(100);
    expect(resolved[1]!.indexedLevel).toBeCloseTo(102, 4);
    expect(resolved[2]!.indexedLevel).toBeCloseTo(104, 4);
    expect(resolved[3]!.indexedLevel).toBeCloseTo(106, 4);
  });

  it('prefere TWR recalculado sobre fechamentos gravados planos', () => {
    const merged = [
      { date: '2026-01-01', patrimony: 1_000_000 },
      { date: '2026-01-02', patrimony: 1_050_000 },
    ];
    const performancePoints = [
      { date: '2026-01-01', cumulativeReturnTwr: 0 },
      { date: '2026-01-02', cumulativeReturnTwr: 0.05 },
    ];
    const flatStored = buildStoredTwrChartSeries(
      [storedRow('2026-01-01', 0), storedRow('2026-01-02', 0)],
      ['2026-01-01', '2026-01-02'],
      '2026-01-01'
    );
    const resolved = resolvePortfolioIndexedForChart(
      merged,
      performancePoints,
      flatStored
    );
    expect(resolved[1]!.indexedLevel).toBeCloseTo(105, 1);
    expect(resolved[1]!.periodReturnToDate).toBeCloseTo(0.05, 4);
  });
});
