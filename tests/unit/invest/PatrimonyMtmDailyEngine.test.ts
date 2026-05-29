import { buildDailyPatrimonyMtmSeries } from '../../../src/core/invest/PatrimonyMtmDailyEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

const anchors = {
  month_ends: [
    { date: '2026-01-01', patrimony: 1_000_000 },
    { date: '2026-01-31', patrimony: 1_100_000 },
    { date: '2026-12-31', patrimony: 1_200_000 },
  ],
  fixed_income_total: 100_000,
};

function stockOpen(qty: number, price: number, date = '2026-01-01'): LedgerEvent {
  return {
    asset_id: 's1',
    asset_ticker: 'PRIO3',
    asset_type: 'stock',
    transaction_type: 'opening_balance',
    transaction_date: date,
    quantity: qty,
    unit_price: price,
    total_net_value: 0,
    impacts_managerial_price: true,
  };
}

function shortPut(
  ticker: string,
  qty: number,
  premium: number,
  date: string
): LedgerEvent {
  return {
    asset_id: `o-${ticker}`,
    asset_ticker: ticker,
    asset_type: 'option_put',
    transaction_type: 'put_sell',
    transaction_date: date,
    quantity: -qty,
    unit_price: premium,
    total_net_value: qty * premium,
    impacts_managerial_price: true,
  };
}

describe('PatrimonyMtmDailyEngine', () => {
  it('alinha patrimônio às âncoras mensais BTG', () => {
    const entries: LedgerEvent[] = [
      stockOpen(1000, 50),
      {
        asset_id: 'c1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 200_000,
        unit_price: 1,
        total_net_value: 200_000,
        impacts_managerial_price: false,
      },
    ];
    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-31', {
      anchors,
      stockQuotes: { PRIO3: 50 },
      fixedIncomeTotal: 100_000,
      calibrateToAnchors: true,
    });
    const last = r.series[r.series.length - 1]!;
    expect(last.patrimony).toBeCloseTo(1_100_000, 0);
  });

  it('zera marcação de opção após vencimento', () => {
    const entries: LedgerEvent[] = [
      stockOpen(100, 40),
      shortPut('PRIOQ43', 100, 1, '2026-01-05'),
    ];
    const r = buildDailyPatrimonyMtmSeries(entries, '2026-05-10', '2026-05-20', {
      anchors,
      stockQuotes: { PRIO3: 40 },
      fixedIncomeTotal: 0,
      calibrateToAnchors: true,
    });
    expect(r.meta.method).toBe('mtm_btg_calibrated');
    expect(r.series.length).toBeGreaterThan(0);
  });

  it('nao usa cotação atual quando quoteForDate está definido', () => {
    const entries: LedgerEvent[] = [stockOpen(100, 10, '2026-01-01')];
    const quoteForDate = (_ticker: string, date: string) =>
      date === '2026-01-02' ? 20 : 10;

    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-02', {
      stockQuotes: { PRIO3: 999 },
      quoteForDate,
      fixedIncomeTotal: 0,
    });
    const day2 = r.series.find((p) => p.date === '2026-01-02');
    expect(day2?.patrimony).toBeCloseTo(2000, 0);
  });
});
