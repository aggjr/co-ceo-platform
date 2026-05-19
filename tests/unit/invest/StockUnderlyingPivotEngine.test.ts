import { buildStockUnderlyingPivot } from '../../../src/core/invest/StockUnderlyingPivotEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function ev(partial: Partial<LedgerEvent> & Pick<LedgerEvent, 'transaction_type' | 'transaction_date'>): LedgerEvent {
  return {
    asset_id: partial.asset_id || 'a1',
    asset_ticker: partial.asset_ticker || 'PRIO3',
    asset_type: partial.asset_type || 'stock',
    quantity: partial.quantity ?? 100,
    unit_price: partial.unit_price ?? 50,
    total_net_value: partial.total_net_value ?? 0,
    impacts_managerial_price: true,
    ...partial,
  } as LedgerEvent;
}

describe('buildStockUnderlyingPivot', () => {
  it('separa day trade de swing na venda no mesmo dia da compra', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 0,
        unit_price: 0,
        total_net_value: 0,
      }),
      ev({
        asset_id: 's1',
        transaction_type: 'buy',
        transaction_date: '2026-03-10',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      }),
      ev({
        asset_id: 's1',
        transaction_type: 'sell',
        transaction_date: '2026-03-10',
        quantity: 100,
        unit_price: 42,
        total_net_value: 4200,
        brokerage_fee: 10,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');
    expect(row).toBeDefined();
    expect(row!.day_trade).toBeCloseTo(200, 0);
    expect(row!.trade).toBeCloseTo(0, 0);
    expect(row!.taxas).toBeGreaterThan(0);
    expect(row!.ganho_aproximado).toBeCloseTo(190, 0);
  });

  it('agrega prêmio de put vendida na coluna venda_put', () => {
    const entries: LedgerEvent[] = [
      ev({
        asset_id: 'o1',
        asset_ticker: 'PRIOQ43',
        asset_type: 'option_put',
        underlying_ticker: 'PRIO3',
        transaction_type: 'put_sell',
        transaction_date: '2026-02-01',
        quantity: 100,
        unit_price: 1.5,
        total_net_value: 150,
      }),
    ];
    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');
    expect(row?.venda_put).toBeCloseTo(150, 0);
  });
});
