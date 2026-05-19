import { buildDailyPatrimonyMtmSeries } from '../../../src/core/invest/PatrimonyMtmDailyEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

const anchors = {
  month_ends: [
    { date: '2026-01-01', patrimony: 1_000_000 },
    { date: '2026-01-31', patrimony: 1_500_000 },
  ],
  fixed_income_total: 0,
};

describe('PatrimonyMtmDailyEngine economic mode', () => {
  it('não calibra patrimônio às âncoras BTG quando calibrateToAnchors=false', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 's1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 1000,
        unit_price: 50,
        total_net_value: 0,
        impacts_managerial_price: true,
      },
    ];
    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-15', {
      anchors,
      stockQuotes: { PRIO3: 50 },
      fixedIncomeTotal: 0,
      calibrateToAnchors: false,
    });
    expect(r.series[r.series.length - 1]!.patrimony).toBeCloseTo(50_000, 0);
    expect(r.meta.method).toBe('mtm_economic');
  });
});
