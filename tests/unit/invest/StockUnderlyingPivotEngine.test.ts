import {
  buildStockUnderlyingPivot,
  enrichStockPivotWithQuotes,
  type StockPivotColumnKey,
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

const GAIN_COLS: StockPivotColumnKey[] = [
  'venda_call',
  'compra_call',
  'venda_put',
  'compra_put',
  'dividendos',
  'jcp',
  'locacao_acao',
  'trade',
  'day_trade',
  'bonus',
  'outros_ganhos',
];

function expectConservation(row: Record<StockPivotColumnKey, number>): void {
  const gainSum = GAIN_COLS.reduce((acc, col) => acc + row[col], 0);
  expect(row.ganho_aproximado).toBeCloseTo(gainSum + row.taxas, 2);
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
    expectConservation(row!);
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

  it('cost_adjustment e rateio de juros entram em taxas, nao em outros ganhos', () => {
    const entries: LedgerEvent[] = [
      ev({
        asset_id: 's1',
        transaction_type: 'cost_adjustment',
        transaction_date: '2026-03-10',
        quantity: 0,
        unit_price: 50,
        total_net_value: 50,
        notes: 'Rateio juros/multa: JUROS SOBRE SALDO NEGATIVO',
      }),
      ev({
        asset_id: 's1-fee',
        transaction_type: 'fee',
        transaction_date: '2026-03-11',
        quantity: 0,
        unit_price: 0,
        total_net_value: -5,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');
    expect(row).toBeDefined();
    expect(row!.outros_ganhos).toBe(0);
    expect(row!.taxas).toBeCloseTo(-55, 2);
    expect(row!.ganho_aproximado).toBeCloseTo(-55, 2);
  });

  it('inclui renda fixa (LFT) com trade de compra/venda', () => {
    const entries: LedgerEvent[] = [
      ev({
        asset_id: 'lft1',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 58,
        unit_price: 17809.83,
        total_net_value: 0,
      }),
      ev({
        asset_id: 'lft1',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'buy',
        transaction_date: '2026-02-05',
        quantity: 2,
        unit_price: 18000,
        total_net_value: -36000,
      }),
      ev({
        asset_id: 'lft1',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'sell',
        transaction_date: '2026-03-10',
        quantity: 1,
        unit_price: 18100,
        total_net_value: 18100,
      }),
    ];
    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'LFT-20310301');
    expect(row).toBeDefined();
    expect(row!.trade).toBeGreaterThan(0);
    expect(row!.preco_estrito).toBeGreaterThan(0);
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

  it('conserva ganho_aproximado como soma das colunas de ganho + taxas', () => {
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
        asset_id: 'o1',
        asset_ticker: 'PRIOA450',
        asset_type: 'option_call',
        underlying_ticker: 'PRIO3',
        transaction_type: 'call_sell',
        transaction_date: '2026-03-12',
        quantity: 100,
        unit_price: 1,
        total_net_value: 100,
      }),
      ev({
        asset_id: 'fii1',
        asset_ticker: 'MXRF11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-03-13',
        quantity: 0,
        unit_price: 0,
        total_net_value: 15,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    for (const row of r.rows) {
      expectConservation(row);
    }
    expectConservation(r.totals);
  });

  it('calcula P&L correto apos split (custodia mantem custo total)', () => {
    const entries: LedgerEvent[] = [
      ev({
        asset_id: 's1',
        transaction_type: 'buy',
        transaction_date: '2026-02-01',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      }),
      ev({
        asset_id: 's1',
        transaction_type: 'split',
        transaction_date: '2026-02-15',
        quantity: 200,
        unit_price: 20,
        total_net_value: 0,
      }),
      ev({
        asset_id: 's1',
        transaction_type: 'sell',
        transaction_date: '2026-03-10',
        quantity: 200,
        unit_price: 21,
        total_net_value: 4200,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');
    expect(row).toBeDefined();
    expect(row!.trade).toBeCloseTo(200, 0);
    expect(row!.ganho_aproximado).toBeCloseTo(200, 0);
    expectConservation(row!);
  });

  it('lanca perda de call long expirada a zero via revaluation em compra_call', () => {
    const entries: LedgerEvent[] = [
      ev({
        asset_id: 'oc1',
        asset_ticker: 'PRIOA450',
        asset_type: 'option_call',
        underlying_ticker: 'PRIO3',
        transaction_type: 'call_buy',
        transaction_date: '2026-01-15',
        quantity: 100,
        unit_price: 2,
        total_net_value: -200,
      }),
      ev({
        asset_id: 'oc1',
        asset_ticker: 'PRIOA450',
        asset_type: 'option_call',
        underlying_ticker: 'PRIO3',
        transaction_type: 'revaluation',
        transaction_date: '2026-02-20',
        quantity: 0,
        unit_price: 0,
        total_net_value: 0,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'PRIO3');
    expect(row).toBeDefined();
    expect(row!.compra_call).toBeCloseTo(-200, 0);
    expect(row!.ganho_aproximado).toBeCloseTo(-200, 0);
    expectConservation(row!);
  });

  it('mapeia amortization explicitamente em outros_ganhos com sinal liquido', () => {
    const entries: LedgerEvent[] = [
      ev({
        asset_id: 'fii1',
        asset_ticker: 'MXRF11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-03-10',
        quantity: 0,
        unit_price: 0,
        total_net_value: 30,
      }),
    ];

    const r = buildStockUnderlyingPivot(entries, '2026-01-01', '2026-12-31');
    const row = r.rows.find((x) => x.underlying === 'MXRF11');
    expect(row).toBeDefined();
    expect(row!.outros_ganhos).toBeCloseTo(30, 2);
    expect(row!.ganho_aproximado).toBeCloseTo(30, 2);
    expectConservation(row!);
  });
});
