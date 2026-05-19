import {
  computeModifiedDietz,
  computePortfolioPerformance,
} from '../../../src/core/invest/portfolioPerformance';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function ev(
  partial: Partial<LedgerEvent> & { transaction_type: string; total_net_value: number }
): LedgerEvent {
  return {
    id: '1',
    transaction_date: partial.transaction_date ?? '2026-01-01',
    asset_ticker: 'CAIXA-BTG',
    asset_type: 'cash',
    asset_id: 'c1',
    quantity: 0,
    unit_price: 0,
    ...partial,
  } as LedgerEvent;
}

describe('computePortfolioPerformance', () => {
  it('ignora dividendos no ajuste — só capital_deposit/withdrawal quebra', () => {
    const series = [
      { date: '2026-01-01', patrimony: 1_000_000 },
      { date: '2026-01-02', patrimony: 1_010_000 },
      { date: '2026-01-03', patrimony: 1_510_000 },
    ];
    const entries = [
      ev({
        transaction_date: '2026-01-02',
        transaction_type: 'dividend',
        total_net_value: 10_000,
        asset_ticker: 'ITUB4',
        asset_type: 'stock',
      }),
      ev({
        transaction_date: '2026-01-03',
        transaction_type: 'capital_deposit',
        total_net_value: 500_000,
      }),
    ];

    const perf = computePortfolioPerformance(series, entries, '2026-01-01', '2026-01-03')!;
    expect(perf.periodReturnSimple).toBeCloseTo(0.51, 2);
    expect(perf.periodGainBrl).toBe(10_000);
    expect(perf.periodReturnTwr).toBeCloseTo(0.01, 2);
  });

  it('retirada externa não distorce negativamente o TWR', () => {
    const series = [
      { date: '2026-01-01', patrimony: 2_000_000 },
      { date: '2026-01-02', patrimony: 2_050_000 },
      { date: '2026-01-03', patrimony: 1_050_000 },
    ];
    const entries = [
      ev({
        transaction_date: '2026-01-03',
        transaction_type: 'capital_withdrawal',
        total_net_value: -1_000_000,
      }),
    ];
    const perf = computePortfolioPerformance(series, entries, '2026-01-01', '2026-01-03')!;
    expect(perf.periodGainBrl).toBeCloseTo(50_000, 0);
    expect(perf.periodReturnTwr).toBeCloseTo(0.025, 3);
  });
});

describe('computeModifiedDietz', () => {
  it('pondera aporte no meio do período', () => {
    const withDeposit = computeModifiedDietz(
      1_000_000,
      1_550_000,
      [{ date: '2026-01-02', amount: 500_000, operation: 'capital_deposit' }],
      '2026-01-01',
      '2026-01-03'
    );
    expect(withDeposit).toBeGreaterThan(0);
    expect(withDeposit).toBeLessThan(0.2);
  });
});
