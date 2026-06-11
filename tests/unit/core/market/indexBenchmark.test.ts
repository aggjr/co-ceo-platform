import {
  buildCdiBenchmarkForChart,
  buildStockBenchmarkForChart,
} from '../../../../src/core/market/indexBenchmark';
import { resolvePortfolioIndexedForChart } from '../../../../src/core/invest/storedPatrimonyChart';

describe('indexBenchmark', () => {
  const alignDates = ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];

  it('alinha carteira, CDI e acao benchmark na mesma malha diaria', () => {
    const portfolioIndexed = resolvePortfolioIndexedForChart(
      [
        { date: '2026-01-02', patrimony: 100_000 },
        { date: '2026-01-03', patrimony: 101_000 },
        { date: '2026-01-04', patrimony: 101_000 },
        { date: '2026-01-05', patrimony: 103_000 },
      ],
      [
        { date: '2026-01-02', cumulativeReturnTwr: 0 },
        { date: '2026-01-03', cumulativeReturnTwr: 0.01 },
        { date: '2026-01-04', cumulativeReturnTwr: 0.01 },
        { date: '2026-01-05', cumulativeReturnTwr: 0.03 },
      ],
      []
    );

    const cdi = buildCdiBenchmarkForChart(
      [
        { reference_date: '2026-01-02', daily_factor: 1.0005 },
        { reference_date: '2026-01-05', daily_factor: 1.0004 },
      ],
      '2026-01-02',
      '2026-01-05',
      alignDates
    );

    const prio = buildStockBenchmarkForChart(
      [
        { quote_date: '2026-01-02', closing_price: 40 },
        { quote_date: '2026-01-05', closing_price: 44 },
      ],
      alignDates,
      'PRIO3'
    );

    expect(portfolioIndexed.map((p) => p.date)).toEqual(alignDates);
    expect(cdi.series.map((p) => p.date)).toEqual(alignDates);
    expect(prio.series.map((p) => p.date)).toEqual(alignDates);

    expect(portfolioIndexed.at(-1)?.periodReturnToDate).toBeCloseTo(0.03, 6);
    expect(cdi.periodReturn).toBeCloseTo(0.0004, 4);
    expect(prio.periodReturn).toBeCloseTo(0.1, 6);
  });

  it('calcula dailyFactor real da acao e carrega fechamento em dias sem pregao', () => {
    const prio = buildStockBenchmarkForChart(
      [
        { quote_date: '2026-01-02', closing_price: 40 },
        { quote_date: '2026-01-05', closing_price: 44 },
      ],
      alignDates,
      'PRIO3'
    );

    expect(prio.available).toBe(true);
    expect(prio.series[1]?.indexedLevel).toBe(100);
    expect(prio.series[1]?.dailyFactor).toBeNull();
    expect(prio.series[3]?.indexedLevel).toBe(110);
    expect(prio.series[3]?.dailyFactor).toBeCloseTo(1.1, 6);
  });
});
