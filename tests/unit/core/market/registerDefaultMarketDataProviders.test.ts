import { MarketDataProviderRegistry } from '../../../../src/core/market/MarketDataProviderRegistry';
import {
  listDefaultProviderCodes,
  registerDefaultMarketDataProviders,
} from '../../../../src/core/market/registerDefaultMarketDataProviders';
import { resolvePrecedenceForField } from '../../../../src/core/market/marketDataPrecedenceCatalog';

jest.mock('../../../../src/core/invest/B3QuoteProvider', () => ({
  fetchB3Quotes: jest.fn(async (_tickers: string[], _opts: unknown) => [
    { ticker: 'PRIO3', price: 42, asOf: '2026-06-17', kind: 'close' },
  ]),
}));

jest.mock('../../../../src/core/invest/opcoesNetQuotes', () => ({
  fetchOptionQuotesWithFallback: jest.fn(async () => []),
}));

jest.mock('../../../../src/core/invest/TesouroDiretoQuoteProvider', () => ({
  fetchTesouroDiretoQuotes: jest.fn(async () => []),
}));

describe('registerDefaultMarketDataProviders (M-01)', () => {
  it('registra brapi, opcoes_net e tesouro_direto idempotentemente', () => {
    const registry = new MarketDataProviderRegistry();
    const first = registerDefaultMarketDataProviders(registry);
    const second = registerDefaultMarketDataProviders(registry);
    expect([...first].sort()).toEqual([...listDefaultProviderCodes()].sort());
    expect(second).toEqual([]);
    expect(registry.listSourceCodes().sort()).toEqual([...listDefaultProviderCodes()].sort());
  });

  it('fetchWithPrecedence usa catalogo A-02 + provider brapi registrado', async () => {
    const registry = new MarketDataProviderRegistry();
    registerDefaultMarketDataProviders(registry);
    const precedence = resolvePrecedenceForField('stock', 'daily_close_price');
    const report = await registry.fetchWithPrecedence(
      {
        asOfDate: '2026-06-17',
        asset: { ticker: 'PRIO3', assetSubcategory: 'stock' },
        fields: ['daily_close_price'],
      },
      precedence
    );
    expect(report.resolvedByField.daily_close_price?.value).toBe(42);
    expect(report.resolvedByField.daily_close_price?.sourceCode).toBe('brapi');
  });
});
