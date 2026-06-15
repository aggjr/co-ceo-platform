import {
  buildStockUnderlyingPivot,
  enrichStockPivotWithQuotes,
} from '../../../src/core/invest/StockUnderlyingPivotEngine';
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
        total_net_value: 4190,
        brokerage_fee: 10,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');
    expect(row).toBeDefined();
    expect(row!.day_trade).toBeCloseTo(200, 0);
    expect(row!.trade).toBeCloseTo(0, 0);
    expect(row!.taxas).toBeLessThan(0);
    expect(row!.ganho_aproximado).toBeCloseTo(190, 0);
  });

  it('mantém despesas negativas e resultado igual à soma das colunas de resultado', () => {
    const entries: LedgerEvent[] = [
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
        transaction_date: '2026-03-11',
        quantity: 100,
        unit_price: 42,
        total_net_value: 4190,
        brokerage_fee: 10,
      }),
      ev({
        asset_id: 's1-yield',
        transaction_type: 'cash_yield',
        transaction_date: '2026-03-12',
        quantity: 0,
        unit_price: 0,
        total_net_value: 25,
      }),
      ev({
        asset_id: 's1-fee',
        transaction_type: 'fee',
        transaction_date: '2026-03-13',
        quantity: 0,
        unit_price: 0,
        total_net_value: -5,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');

    expect(row).toBeDefined();
    expect(row!.trade).toBeCloseTo(200, 2);
    expect(row!.outros_ganhos).toBeCloseTo(25, 2);
    expect(row!.taxas).toBeCloseTo(-15, 2);
    expect(row!.ganho_aproximado).toBeCloseTo(210, 2);
  });

  it('mantém prêmio de put vendida em resultado_custodia até ser fechada', () => {
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
    expect(row?.resultado_custodia).toBeCloseTo(150, 0);
  });

  it('preenche PM e cotacao atual no pivot por acao', () => {
    const pivot = buildStockUnderlyingPivot(
      [
        ev({
          asset_id: 's1',
          transaction_type: 'buy',
          transaction_date: '2026-03-10',
          quantity: 100,
          unit_price: 40,
          total_net_value: -4000,
        }),
        ev({
          asset_id: 'd1',
          transaction_type: 'dividend',
          transaction_date: '2026-03-11',
          quantity: 0,
          unit_price: 0,
          total_net_value: 10,
        }),
      ],
      '2026-01-01',
      '2026-12-31'
    );

    const enriched = enrichStockPivotWithQuotes(pivot, {
      PRIO3: { lastPrice: 42.5 },
    });
    const row = enriched.rows.find((x) => x.underlying === 'PRIO3');

    expect(row?.preco_estrito).toBeCloseTo(40, 4);
    expect(row?.cotacao_atual).toBeCloseTo(42.5, 4);
  });
});
