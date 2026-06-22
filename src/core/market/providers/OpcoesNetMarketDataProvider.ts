import { fetchOptionQuotesWithFallback } from '../../invest/opcoesNetQuotes';
import type {
  CanonicalMarketField,
  MarketDataProvider,
  MarketDataRequest,
  MarketDataResult,
} from '../types';

const OPTION_FIELDS: CanonicalMarketField[] = [
  'daily_close_price',
  'contract_strike',
  'contract_expiration',
  'contract_option_type',
  'contract_underlying',
];

const OPCOES_NET_CAPABILITIES = [
  {
    assetSubcategories: ['option_call', 'option_put', 'option_br', '*'],
    fields: OPTION_FIELDS,
    historical: true,
    realtime: false,
    priority: 20,
  },
];

function mapOptionField(
  field: CanonicalMarketField,
  quote: Awaited<ReturnType<typeof fetchOptionQuotesWithFallback>>[number]
): MarketDataResult | null {
  switch (field) {
    case 'daily_close_price':
      return quote.price != null
        ? {
            asset: { ticker: quote.ticker, assetSubcategory: 'option_br' },
            field,
            value: quote.price,
            asOfDate: quote.asOf,
            sourceCode: 'opcoes_net',
            confidence: quote.source === 'opcoes_net' ? 'external' : 'estimated',
            metadata: { provider: quote.provider, requested_source: 'opcoes_net' },
          }
        : null;
    case 'contract_strike':
      return quote.strikePrice != null
        ? {
            asset: { ticker: quote.ticker, assetSubcategory: 'option_br' },
            field,
            value: quote.strikePrice,
            asOfDate: quote.asOf,
            sourceCode: 'opcoes_net',
            confidence: 'external',
          }
        : null;
    case 'contract_expiration':
      return quote.expirationDate
        ? {
            asset: { ticker: quote.ticker, assetSubcategory: 'option_br' },
            field,
            value: quote.expirationDate,
            asOfDate: quote.asOf,
            sourceCode: 'opcoes_net',
            confidence: 'external',
          }
        : null;
    case 'contract_option_type':
      return quote.optionType
        ? {
            asset: { ticker: quote.ticker, assetSubcategory: 'option_br' },
            field,
            value: quote.optionType,
            asOfDate: quote.asOf,
            sourceCode: 'opcoes_net',
            confidence: 'external',
          }
        : null;
    case 'contract_underlying':
      return quote.underlyingTicker
        ? {
            asset: { ticker: quote.ticker, assetSubcategory: 'option_br' },
            field,
            value: quote.underlyingTicker,
            asOfDate: quote.asOf,
            sourceCode: 'opcoes_net',
            confidence: 'external',
          }
        : null;
    default:
      return null;
  }
}

/** Wrapper M-01 — opcoes via opcoesNetQuotes (preco + metadata de contrato). */
export class OpcoesNetMarketDataProvider implements MarketDataProvider {
  readonly sourceCode = 'opcoes_net';
  readonly capabilities = OPCOES_NET_CAPABILITIES.map((c) => ({
    ...c,
    fields: [...c.fields],
  }));

  async canHandle(request: MarketDataRequest): Promise<boolean> {
    return request.fields.every((f) => OPTION_FIELDS.includes(f));
  }

  async fetch(request: MarketDataRequest): Promise<MarketDataResult[]> {
    const ticker = request.asset.ticker.toUpperCase();
    const quotes = await fetchOptionQuotesWithFallback([ticker], {
      asOfDate: request.asOfDate,
    });
    const hit = quotes.find((q) => q.ticker.toUpperCase() === ticker);
    if (!hit) return [];
    const out: MarketDataResult[] = [];
    for (const field of request.fields) {
      const row = mapOptionField(field, hit);
      if (row) out.push({ ...row, asset: request.asset });
    }
    return out;
  }
}
