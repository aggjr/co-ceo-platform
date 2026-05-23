import {
  buildCdiBenchmarkForChart,
  buildIndexedLevelSeries,
  buildPatrimonyIndexedSeries,
  buildStockBenchmarkForChart,
  compoundedFactor,
  periodReturnFromLevelSeries,
} from '../../../src/core/market/indexBenchmark';

describe('indexBenchmark', () => {
  it('acumula fatores diários e mantém nível em dia sem observação', () => {
    const rows = [
      { reference_date: '2026-01-02', daily_factor: 1.0005 },
      { reference_date: '2026-01-05', daily_factor: 1.0004 },
    ];
    const series = buildIndexedLevelSeries(rows, '2026-01-02', '2026-01-05', 100);
    expect(series).toHaveLength(4);
    expect(series[0]).toMatchObject({ date: '2026-01-02', hadObservation: true });
    expect(series[1]).toMatchObject({ date: '2026-01-03', hadObservation: false, level: 100.05 });
    expect(series[3]!.level).toBeGreaterThan(100.09);
    const ret = periodReturnFromLevelSeries(series);
    expect(ret).not.toBeNull();
    expect(compoundedFactor(rows, '2026-01-02', '2026-01-05')).toBeCloseTo(1.0005 * 1.0004, 8);
  });

  it('buildCdiBenchmarkForChart alinha às datas do patrimônio', () => {
    const rows = [
      { reference_date: '2026-01-02', daily_factor: 1.001 },
      { reference_date: '2026-01-03', daily_factor: 1.002 },
    ];
    const payload = buildCdiBenchmarkForChart(rows, '2026-01-02', '2026-01-04', [
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(payload.available).toBe(true);
    expect(payload.series).toHaveLength(3);
    expect(payload.series[2]!.indexedLevel).toBeGreaterThan(payload.series[0]!.indexedLevel);
  });

  it('buildStockBenchmarkForChart indexa fechamentos da ação', () => {
    const quotes = [
      { quote_date: '2026-01-02', closing_price: 40 },
      { quote_date: '2026-01-03', closing_price: 44 },
    ];
    const payload = buildStockBenchmarkForChart(quotes, ['2026-01-02', '2026-01-03'], 'PRIO3');
    expect(payload.available).toBe(true);
    expect(payload.series[0]!.indexedLevel).toBe(100);
    expect(payload.series[1]!.indexedLevel).toBe(110);
    expect(payload.periodReturn).toBeCloseTo(0.1, 4);
  });

  it('buildPatrimonyIndexedSeries normaliza patrimônio em índice 100', () => {
    const idx = buildPatrimonyIndexedSeries([
      { date: '2026-01-01', patrimony: 1_000_000 },
      { date: '2026-01-02', patrimony: 1_050_000 },
    ]);
    expect(idx[0]!.indexedLevel).toBe(100);
    expect(idx[1]!.periodReturnToDate).toBeCloseTo(0.05, 4);
  });
});
