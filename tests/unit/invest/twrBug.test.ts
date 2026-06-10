
import { computePortfolioPerformance, computeTwrFromMonthEndAnchors } from '../../../src/core/invest/portfolioPerformance';

describe('TWR with smoothed anchors and flows', () => {
  test('Linear interpolation with massive flow causes negative TWR', () => {
    const series = [];
    for (let i = 1; i <= 30; i++) {
      const w = i / 30;
      const patrimony = 100000 + w * (210000 - 100000);
      series.push({ date: `2026-01-${i.toString().padStart(2, '0')}`, patrimony });
    }

    const entries = [
      {
        transaction_type: 'capital_deposit',
        transaction_date: '2026-01-15',
        total_net_value: 100000,
      } as any
    ];

    const perf = computePortfolioPerformance(series, entries, '2026-01-01', '2026-01-30');
    console.log('Daily Smoothed TWR:', perf!.periodReturnTwr);
    
    expect(perf!.periodReturnTwr).toBeLessThan(0);
    
    const monthLinked = computeTwrFromMonthEndAnchors({
      month_ends: [
        { date: '2026-01-01', patrimony: 100000 },
        { date: '2026-01-30', patrimony: 210000 }
      ],
      fixed_income_total: 0
    }, entries, '2026-01-01', '2026-01-30');
    
    console.log('Month Anchor TWR:', monthLinked!.periodReturnTwr);
    expect(monthLinked!.periodReturnTwr).toBeGreaterThan(0);
  });
});
