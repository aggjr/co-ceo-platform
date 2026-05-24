/**
 * @tags parity user-expectation invest market
 * Valida o que o usuário vê na carteira: cotação de mercado ≠ PM; vazio quando sem fonte.
 */
import { enrichPortfolioRow, equityResultFromB3Quote } from '../../src/core/invest/portfolioMapper';
import {
  PARITY_LIVE,
  REFERENCE_TICKERS,
  fetchReferenceEquityQuote,
  quotesWithinTolerance,
} from '../helpers/marketReference';

describe('@parity @user-expectation cotações na carteira', () => {
  it('ação: updatedQuote é o preço de mercado, nunca o PM B3', () => {
    const pmB3 = 64.38;
    const market = 68.82;
    const row = enrichPortfolioRow(
      {
        id: 's1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        current_quantity: 100,
        managerial_avg_price: 55.7,
        metadata: { last_price: 99 },
        status: 'active',
      },
      { strict: 60, b3: pmB3, managerial: 55.7 },
      undefined,
      { price: market }
    );
    expect(row.updatedQuote).toBe(market);
    expect(row.updatedQuote).not.toBe(pmB3);
    expect(row.marketValue).toBeCloseTo(100 * market, 2);
    expect(row.costBasis).toBeCloseTo(100 * pmB3, 2);
  });

  it('ação: sem marketQuote não usa PM como se fosse cotação', () => {
    const row = enrichPortfolioRow(
      {
        id: 's2',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        current_quantity: 100,
        managerial_avg_price: 40,
        metadata: {},
        status: 'active',
      },
      { strict: 40, b3: 42, managerial: 40 },
      undefined,
      null
    );
    expect(row.updatedQuote).toBeNull();
    expect(row.marketValue).toBe(0);
  });

  it('ação: resultado exibido usa cotação − PM B3 (expectativa B3)', () => {
    const pmB3 = 64.38;
    const quote = 68.82;
    const qty = 12700;
    expect(equityResultFromB3Quote(pmB3, quote, qty)).toBeCloseTo((quote - pmB3) * qty, 0);
  });

  const live = PARITY_LIVE ? it : it.skip;
  for (const ticker of REFERENCE_TICKERS) {
    live(`live brapi: ${ticker} alimenta enrichPortfolioRow com preço coerente`, async () => {
      const ref = await fetchReferenceEquityQuote(ticker);
      const row = enrichPortfolioRow(
        {
          id: `live-${ticker}`,
          asset_ticker: ticker,
          asset_type: 'stock',
          current_quantity: 1,
          managerial_avg_price: ref.price * 0.5,
          metadata: {},
          status: 'active',
        },
        { strict: ref.price * 0.5, b3: ref.price * 0.6, managerial: ref.price * 0.5 },
        undefined,
        { price: ref.price }
      );
      expect(row.updatedQuote).toBe(ref.price);
      expect(quotesWithinTolerance(row.updatedQuote!, ref.price, 0.001)).toBe(true);
    });
  }
});
