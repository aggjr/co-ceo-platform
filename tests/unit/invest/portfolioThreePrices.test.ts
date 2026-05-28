import {
  resolveEquityThreePricesForPortfolioRow,
} from '../../../src/core/invest/portfolioThreePrices';
import type { ThreePrices } from '../../../src/core/invest/threePricesEngine';

describe('portfolioThreePrices', () => {
  it('usa PM do engine quando lote aberto', () => {
    const engine = new Map<string, ThreePrices>([
      [
        'ITUB4',
        { qty: 500, estrito: 36.4, b3: 35.1, gerencial: 34.2, lotStart: '2026-01-02' },
      ],
    ]);
    const row = {
      asset_ticker: 'ITUB4',
      asset_type: 'stock',
      current_quantity: 500,
      acquisition_value: 18200,
    };
    const pm = resolveEquityThreePricesForPortfolioRow(row, new Map(), engine);
    expect(pm.strict).toBeCloseTo(36.4, 2);
    expect(pm.b3).toBeCloseTo(35.1, 2);
    expect(pm.managerial).toBeCloseTo(34.2, 2);
  });

  it('cai para acquisition/qty quando engine sem lote', () => {
    const row = {
      asset_ticker: 'BBAS3',
      asset_type: 'stock',
      current_quantity: 1000,
      acquisition_value: 21070,
      managerial_avg_price: 0,
    };
    const pm = resolveEquityThreePricesForPortfolioRow(
      row,
      new Map(),
      new Map()
    );
    expect(pm.strict).toBeCloseTo(21.07, 2);
    expect(pm.b3).toBeCloseTo(21.07, 2);
    expect(pm.managerial).toBeCloseTo(21.07, 2);
  });
});
