import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';
import { buildPnLPivot } from '../../../src/core/invest/PnLPivotEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function ev(partial: Partial<LedgerEvent> & Pick<LedgerEvent, 'asset_id' | 'asset_ticker' | 'transaction_type'>): LedgerEvent {
  return {
    asset_type: 'stock',
    quantity: 100,
    unit_price: 10,
    total_net_value: 1000,
    impacts_managerial_price: true,
    ...partial,
  };
}

describe('PnLPivotEngine', () => {
  it('agrega dividendo e despesas no pivot', () => {
    const events: LedgerEvent[] = [
      ev({
        asset_id: 'a1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        underlying_ticker: 'PRIO3',
        transaction_type: 'opening_balance',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      }),
      ev({
        asset_id: 'a1',
        asset_ticker: 'PRIO3',
        transaction_type: 'dividend',
        quantity: 0,
        unit_price: 0,
        total_net_value: 500,
        brokerage_fee: 0,
        b3_fees: 0,
      }),
    ];
    const pivot = buildPnLPivot(events, '2026-01-01', '2026-12-31');
    const row = pivot.rows.find((r) => r.underlying === 'PRIO3');
    expect(row?.dividendos).toBe(500);
  });

  it('recalcula custódia após compra e venda parcial', () => {
    const events: LedgerEvent[] = [
      ev({
        asset_id: 'a1',
        asset_ticker: 'VALE3',
        transaction_type: 'opening_balance',
        quantity: 100,
        unit_price: 50,
        total_net_value: -5000,
      }),
      ev({
        asset_id: 'a1',
        asset_ticker: 'VALE3',
        transaction_type: 'sell',
        quantity: -40,
        unit_price: 60,
        total_net_value: 2400,
      }),
    ];
    const { assets } = rebuildCustodyFromLedger(events);
    expect(assets[0].quantity).toBe(60);
    expect(assets[0].avgPrice).toBe(50);
  });
});
