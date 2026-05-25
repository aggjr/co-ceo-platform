import { resolveInvestPeriodBounds } from '../../../src/core/invest/investPeriodBounds';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('resolveInvestPeriodBounds', () => {
  it('defaultFrom = data de abertura do livro', () => {
    const events: LedgerEvent[] = [
      {
        transaction_date: '2026-01-01',
        transaction_type: 'opening_balance',
        asset_id: 'a1',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        quantity: 100,
        unit_price: 10,
        total_net_value: 1000,
      },
      {
        transaction_date: '2026-03-15',
        transaction_type: 'buy',
        asset_id: 'a1',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        quantity: 10,
        unit_price: 50,
        total_net_value: -500,
      },
    ];
    const bounds = resolveInvestPeriodBounds(events);
    expect(bounds.openingDate).toBe('2026-01-01');
    expect(bounds.defaultFrom).toBe('2026-01-01');
    expect(bounds.periodMin).toBe('2026-01-01');
  });

  it('chartBenchmarkTicker = maior posição em ação quando env vazio', () => {
    const prev = process.env.INVEST_CHART_BENCHMARK_TICKER;
    delete process.env.INVEST_CHART_BENCHMARK_TICKER;
    const events: LedgerEvent[] = [
      {
        transaction_date: '2026-01-01',
        transaction_type: 'opening_balance',
        asset_id: 'p1',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        quantity: 100,
        unit_price: 50,
        total_net_value: 5000,
      },
      {
        transaction_date: '2026-01-01',
        transaction_type: 'opening_balance',
        asset_id: 'v1',
        asset_ticker: 'VALE3',
        asset_type: 'stock',
        quantity: 1000,
        unit_price: 50,
        total_net_value: 50000,
      },
    ];
    const bounds = resolveInvestPeriodBounds(events);
    expect(bounds.chartBenchmarkTicker).toBe('VALE3');
    if (prev) process.env.INVEST_CHART_BENCHMARK_TICKER = prev;
  });
});
