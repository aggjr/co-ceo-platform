import { enrichPortfolioRow } from '../../../src/core/invest/portfolioMapper';
import { strikeFromCatalog } from '../../../src/core/invest/optionStrikeCatalog';
import { resolveOptionStrike } from '../../../src/core/invest/optionStrike';

describe('optionStrikeCatalog', () => {
  it('fornece strike do Profit para notional', () => {
    expect(strikeFromCatalog('PRIOF760')).toBe(76);
    const row = enrichPortfolioRow({
      id: 'o1',
      asset_ticker: 'PRIOF760',
      asset_type: 'option_call',
      current_quantity: -900,
      managerial_avg_price: 1.24,
      metadata: { option_strike: 14303.9 },
      status: 'active',
    });
    expect(row.optionStrike).toBe(76);
    expect(row.notional).toBe(68400);
  });

  it('PRIOR407 usa strike 40,75 e não prêmio no metadata', () => {
    const resolved = resolveOptionStrike({
      ticker: 'PRIOR407',
      meta: { option_strike: 14303.9 },
      managerialAvgPrice: 2.2,
    });
    expect(resolved.strike).toBe(40.75);
    expect(resolved.source).toBe('catalog');
  });
});
