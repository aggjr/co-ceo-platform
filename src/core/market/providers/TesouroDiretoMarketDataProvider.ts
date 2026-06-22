import { fetchTesouroDiretoQuotes } from '../../invest/TesouroDiretoQuoteProvider';
import type {
  MarketDataProvider,
  MarketDataRequest,
  MarketDataResult,
} from '../types';

const TESOURO_CAPABILITIES = [
  {
    assetSubcategories: ['fixed_income', 'tesouro_selic', 'tesouro_prefixado', '*'],
    fields: ['unit_price'] as const,
    historical: true,
    realtime: false,
    priority: 30,
  },
];

/** Wrapper M-01 — PU Tesouro / RF publica via TesouroDiretoQuoteProvider. */
export class TesouroDiretoMarketDataProvider implements MarketDataProvider {
  readonly sourceCode = 'tesouro_direto';
  readonly capabilities = TESOURO_CAPABILITIES.map((c) => ({
    ...c,
    fields: [...c.fields],
  }));

  async canHandle(request: MarketDataRequest): Promise<boolean> {
    return request.fields.every((f) => f === 'unit_price');
  }

  async fetch(request: MarketDataRequest): Promise<MarketDataResult[]> {
    const ticker = request.asset.ticker.toUpperCase();
    const quotes = await fetchTesouroDiretoQuotes([ticker], {
      asOfDate: request.asOfDate,
    });
    const hit = quotes.find((q) => q.ticker.toUpperCase() === ticker);
    if (!hit || hit.price == null) return [];
    const confidence =
      hit.source === 'tesouro_direto' ? ('official' as const) : ('estimated' as const);
    return request.fields
      .filter((f) => f === 'unit_price')
      .map((field) => ({
        asset: request.asset,
        field,
        value: hit.price,
        asOfDate: hit.asOf ?? request.asOfDate,
        sourceCode: this.sourceCode,
        confidence,
        metadata: { kind: hit.kind, provider: hit.provider, raw_source: hit.source },
      }));
  }
}
