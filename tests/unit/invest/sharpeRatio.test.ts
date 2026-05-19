import { computeSharpeRatio, dailyReturnsFromPatrimony } from '../../../src/core/invest/sharpeRatio';

describe('sharpeRatio', () => {
  it('computes annualized sharpe', () => {
    const series = [
      { patrimony: 100 },
      { patrimony: 101 },
      { patrimony: 102 },
      { patrimony: 101.5 },
    ];
    const returns = dailyReturnsFromPatrimony(series);
    const s = computeSharpeRatio(returns);
    expect(s.sharpe).not.toBeNull();
    expect(s.sharpe!).toBeGreaterThan(0);
  });
});
