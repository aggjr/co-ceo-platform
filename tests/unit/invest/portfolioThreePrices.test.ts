import {
  buildThreeAvgPricesByUnderlying,
  computeLotStartDates,
} from '../../../src/core/invest/portfolioThreePrices';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function ev(
  partial: Partial<LedgerEvent> &
    Pick<
      LedgerEvent,
      'asset_ticker' | 'transaction_type' | 'quantity' | 'unit_price' | 'total_net_value'
    >
): LedgerEvent {
  return {
    asset_id: '1',
    asset_type: 'stock',
    transaction_date: '2026-01-01',
    ...partial,
  };
}

describe('portfolioThreePrices', () => {
  it('opção vendida antes da primeira compra não entra no PM gerencial', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2025-06-01',
        asset_ticker: 'PETR4M30',
        asset_type: 'option_put',
        underlying_ticker: 'PETR4',
        transaction_type: 'put_sell',
        quantity: -100,
        unit_price: 5,
        total_net_value: 500,
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

    const prices = buildThreeAvgPricesByUnderlying(entries).get('PETR4')!;
    // Lote começa na compra de 2026-01-10; venda da PUT em 2025-06-01 é pré-lote.
    // Gerencial deve ignorar essa venda e ficar = Estrito.
    expect(prices.strict).toBe(30);
    expect(prices.b3).toBe(30);
    expect(prices.managerial).toBe(30);
  });

  it('opção vendida durante a custódia entra no PM gerencial', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2026-01-10',
        asset_ticker: 'PETR4',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 30,
        total_net_value: -3000,
      }),
      ev({
        transaction_date: '2026-02-05',
        asset_ticker: 'PETR4M28',
        asset_type: 'option_put',
        underlying_ticker: 'PETR4',
        transaction_type: 'put_sell',
        quantity: -100,
        unit_price: 5,
        total_net_value: 500,
      }),
    ];
    const prices = buildThreeAvgPricesByUnderlying(entries).get('PETR4')!;
    expect(prices.strict).toBe(30);
    expect(prices.b3).toBe(30);
    expect(prices.managerial).toBe((100 * 30 - 500) / 100); // 25
  });

  it('lote zera e reabre — opções entre os dois lotes não vazam', () => {
    const entries: LedgerEvent[] = [
      ev({
        transaction_date: '2026-01-10',
        asset_ticker: 'PETR4',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 30,
        total_net_value: -3000,
      }),
      ev({
        transaction_date: '2026-02-10',
        asset_ticker: 'PETR4',
        transaction_type: 'sell',
        quantity: -100,
        unit_price: 35,
        total_net_value: 3500,
      }),
      ev({
        transaction_date: '2026-03-01',
        asset_ticker: 'PETR4A35',
        asset_type: 'option_call',
        underlying_ticker: 'PETR4',
        transaction_type: 'call_sell',
        quantity: -50,
        unit_price: 2,
        total_net_value: 100,
      }),
      ev({
        transaction_date: '2026-04-01',
        asset_ticker: 'PETR4',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 32,
        total_net_value: -3200,
      }),
    ];
    const lotStarts = computeLotStartDates(entries);
    expect(lotStarts.get('PETR4')).toBe('2026-04-01');

    const prices = buildThreeAvgPricesByUnderlying(entries).get('PETR4')!;
    expect(prices.strict).toBe(32);
    expect(prices.b3).toBe(32);
    expect(prices.managerial).toBe(32);
  });
});
