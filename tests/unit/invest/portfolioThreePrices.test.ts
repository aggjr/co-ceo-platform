import {
  computeLotStartDates,
  filterLedgerForManagerialPrice,
} from '../../../src/core/invest/portfolioThreePrices';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function ev(
  partial: Partial<LedgerEvent> & Pick<LedgerEvent, 'asset_ticker' | 'transaction_type' | 'quantity' | 'unit_price' | 'total_net_value'>
): LedgerEvent {
  return {
    asset_id: '1',
    asset_type: 'stock',
    transaction_date: '2026-01-01',
    ...partial,
  };
}

describe('portfolioThreePrices', () => {
  it('exclui opções anteriores ao lote aberto no PM gerencial', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2025-06-01',
        asset_ticker: 'PETR4',
        asset_type: 'option_put',
        transaction_type: 'put_sell',
        quantity: 100,
        unit_price: 1,
        total_net_value: 500,
        underlying_ticker: 'PETR4',
      }),
      ev({
        transaction_date: '2026-01-10',
        asset_ticker: 'PETR4',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 30,
        total_net_value: -3000,
      }),
    ];
    const lotStarts = computeLotStartDates(entries);
    expect(lotStarts.get('PETR4')).toBe('2026-01-10');
    const filtered = filterLedgerForManagerialPrice(entries, lotStarts);
    expect(filtered.some((e) => e.transaction_type === 'put_sell')).toBe(false);
    expect(filtered.some((e) => e.transaction_type === 'buy')).toBe(true);
  });
});
