import { fetchB3Quotes } from '../../invest/B3QuoteProvider';
import type {
  MarketDataProvider,
  MarketDataRequest,
  MarketDataResult,
} from '../types';

const BRAPI_CAPABILITIES = [
  {
    assetSubcategories: ['stock', 'etf', 'fii', 'equity_br', '*'],
    fields: ['daily_close_price'] as const,
    historical: true,
    realtime: false,
    priority: 10,
  },
];

/** Wrapper M-01 — cotacao B3 via brapi (delega B3QuoteProvider). */
export class BrapiMarketDataProvider implements MarketDataProvider {
  readonly sourceCode = 'brapi';
  readonly capabilities = BRAPI_CAPABILITIES.map((c) => ({
    ...c,
    fields: [...c.fields],
  }));

  async canHandle(request: MarketDataRequest): Promise<boolean> {
    return request.fields.every((f) => f === 'daily_close_price');
  }

  async fetch(request: MarketDataRequest): Promise<MarketDataResult[]> {
    const ticker = request.asset.ticker.toUpperCase();
    const quotes = await fetchB3Quotes([ticker], {
      asOfDate: request.asOfDate,
      token: process.env.BRAPI_TOKEN,
    });
    const hit = quotes.find((q) => q.ticker.toUpperCase() === ticker);
    if (!hit || hit.price == null) return [];
    return request.fields
      .filter((f) => f === 'daily_close_price')
      .map((field) => ({
        asset: request.asset,
        field,
        value: hit.price,
        asOfDate: hit.asOf ?? request.asOfDate,
        sourceCode: this.sourceCode,
        confidence: 'external' as const,
        metadata: { kind: hit.kind },
      }));
  }
}
