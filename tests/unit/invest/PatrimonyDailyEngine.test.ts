import { buildDailyPatrimonySeries } from '../../../src/core/invest/PatrimonyDailyEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function ev(partial: Partial<LedgerEvent> & Pick<LedgerEvent, 'transaction_date'>): LedgerEvent {
  return {
    asset_id: partial.asset_id || 'a1',
    asset_ticker: partial.asset_ticker || 'PRIO3',
    asset_type: partial.asset_type || 'stock',
    transaction_type: partial.transaction_type || 'buy',
    quantity: partial.quantity ?? 100,
    unit_price: partial.unit_price ?? 40,
    total_net_value: partial.total_net_value ?? -4000,
    ...partial,
  };
}

describe('PatrimonyDailyEngine', () => {
  it('builds daily series and sharpe from ledger', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2026-01-01',
        transaction_type: 'opening_balance',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      }),
      ev({
        transaction_date: '2026-01-02',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'cash_yield',
        quantity: 0,
        unit_price: 0,
        total_net_value: 50,
      }),
      ev({
        transaction_date: '2026-01-03',
        asset_ticker: 'PRIO3',
        transaction_type: 'sell',
        quantity: -50,
        unit_price: 42,
        total_net_value: 2100,
      }),
    ];

    const result = buildDailyPatrimonySeries(entries, '2026-01-01', '2026-01-05');
    expect(result.series.length).toBeGreaterThanOrEqual(3);
    expect(result.series[0]!.patrimony).toBeCloseTo(4000);
    expect(result.sharpe.observationDays).toBeGreaterThanOrEqual(1);
  });

  it('subtracts pending_settlement from patrimony (lançamentos futuros)', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2026-05-18',
        transaction_type: 'opening_balance',
        quantity: 100,
        unit_price: 100,
        total_net_value: -10000,
      }),
      {
        transaction_date: '2026-05-18',
        asset_id: 'cash-1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: -453223.65,
        impacts_managerial_price: false,
      },
    ];
    const result = buildDailyPatrimonySeries(entries, '2026-05-18', '2026-05-18');
    const last = result.series[result.series.length - 1]!;
    expect(last.patrimonyGross).toBeCloseTo(10000);
    expect(last.pendingSettlements).toBeCloseTo(-453223.65);
    expect(last.patrimony).toBeCloseTo(-443223.65);
  });

  it('defers stock buy cash to D+2 business days', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2026-05-15',
        transaction_type: 'opening_balance',
        quantity: 100,
        unit_price: 50,
        total_net_value: -5000,
      }),
      ev({
        transaction_date: '2026-05-15',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 50,
        total_net_value: -5000,
      }),
    ];
    const result = buildDailyPatrimonySeries(entries, '2026-05-15', '2026-05-19');
    const fri = result.series.find((p) => p.date === '2026-05-15');
    const tue = result.series.find((p) => p.date === '2026-05-19');
    expect(fri?.positionsValue).toBeCloseTo(10000);
    expect(fri?.scheduledCashPending).toBeCloseTo(-5000);
    expect(fri?.cash).toBeCloseTo(0);
    expect(tue?.cash).toBeCloseTo(-5000);
  });
});
