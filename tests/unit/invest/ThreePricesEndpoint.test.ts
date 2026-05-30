import { computeThreePricesByUnderlying } from '../../../src/core/invest/threePricesEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function filterOpenRows(priceMap: ReturnType<typeof computeThreePricesByUnderlying>) {
  const rows: Array<{ ticker: string; qty: number; pmGerencial: number; pmEstrito: number }> = [];
  for (const [ticker, p] of priceMap) {
    if (p.qty <= 0) continue;
    rows.push({
      ticker,
      qty: p.qty,
      pmGerencial: p.gerencial,
      pmEstrito: p.estrito,
    });
  }
  return rows;
}

describe('ThreePrices — endpoint data shape', () => {
  it('retorna apenas ativos com qty > 0', () => {
    const events: LedgerEvent[] = [
      {
        id: 'e1',
        asset_id: 'PETR4',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-10',
        quantity: 1000,
        unit_price: 35.0,
        total_net_value: -35000,
      },
      {
        id: 'e2',
        asset_id: 'PETR4',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        transaction_type: 'sell',
        transaction_date: '2026-02-01',
        quantity: -1000,
        unit_price: 38.0,
        total_net_value: 38000,
      },
    ];
    const map = computeThreePricesByUnderlying(events);
    const petr = map.get('PETR4');
    expect(petr?.qty).toBe(0);
    expect(filterOpenRows(map)).toHaveLength(0);
  });

  it('benefício de opção no PM gerencial', () => {
    const events: LedgerEvent[] = [
      {
        id: 'e1',
        asset_id: 'ITUB4',
        asset_ticker: 'ITUB4',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-05',
        quantity: 500,
        unit_price: 36.0,
        total_net_value: -18000,
      },
      {
        id: 'e2',
        asset_id: 'ITUBK350',
        asset_ticker: 'ITUBK350',
        asset_type: 'option_call',
        underlying_ticker: 'ITUB4',
        transaction_type: 'call_sell',
        transaction_date: '2026-01-10',
        quantity: -500,
        unit_price: 1.2,
        total_net_value: 600,
      },
    ];
    const map = computeThreePricesByUnderlying(events);
    const itub = map.get('ITUB4');
    expect(itub?.qty).toBe(500);
    expect(itub?.estrito).toBeCloseTo(36.0, 2);
    expect(itub?.gerencial).toBeCloseTo(34.8, 2);
    expect(itub!.gerencial).toBeLessThan(itub!.estrito);
  });
});
