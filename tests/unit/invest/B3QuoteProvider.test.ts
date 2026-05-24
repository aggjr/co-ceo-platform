import { describe, expect, it } from 'vitest';
import { fetchB3Quotes } from '../../../src/core/invest/B3QuoteProvider';

describe('fetchB3Quotes', () => {
  it('plano gratuito: 1 ticker por request (ITUB4 e WEGE3)', async () => {
    const token = process.env.BRAPI_TOKEN;
    if (!token) return;

    const prev = process.env.BRAPI_TICKERS_PER_REQUEST;
    process.env.BRAPI_TICKERS_PER_REQUEST = '1';
    process.env.BRAPI_REQUEST_DELAY_MS = '200';
    try {
      const quotes = await fetchB3Quotes(['ITUB4', 'WEGE3'], { token });
      expect(quotes.length).toBeGreaterThanOrEqual(2);
      const tickers = new Set(quotes.map((q) => q.ticker));
      expect(tickers.has('ITUB4')).toBe(true);
      expect(tickers.has('WEGE3')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.BRAPI_TICKERS_PER_REQUEST;
      else process.env.BRAPI_TICKERS_PER_REQUEST = prev;
    }
  });
});
