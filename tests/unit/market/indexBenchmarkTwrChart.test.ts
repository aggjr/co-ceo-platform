import { buildTwrPerformanceChartSeries } from '../../../src/core/market/indexBenchmark';

describe('buildTwrPerformanceChartSeries', () => {
  it('começa em 100 e reflete TWR acumulado', () => {
    const series = buildTwrPerformanceChartSeries([
      { date: '2026-01-01', cumulativeReturnTwr: 0 },
      { date: '2026-01-02', cumulativeReturnTwr: 0.01 },
      { date: '2026-01-03', cumulativeReturnTwr: 0.025 },
    ]);
    expect(series[0]!.indexedLevel).toBe(100);
    expect(series[1]!.indexedLevel).toBe(101);
    expect(series[2]!.periodReturnToDate).toBeCloseTo(0.025, 4);
  });
});
