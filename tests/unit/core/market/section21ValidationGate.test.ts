/**
 * Gate adversarial A-01 (validador independente).
 */
import {
  marketDataProviderRegistry,
  MarketDataProviderRegistry,
} from '../../../../src/core/market/MarketDataProviderRegistry';
import {
  CANONICAL_MARKET_FIELDS,
  MARKET_DATA_FALLBACK_RULES_VERSION,
  MARKET_FIELD_SCOPE,
  type MarketDataProvider,
  type MarketDataRequest,
  type MarketDataSourceFailure,
} from '../../../../src/core/market/types';

function mockProvider(
  sourceCode: string,
  handlers: Partial<{
    canHandle: (req: MarketDataRequest) => boolean;
    fetch: (req: MarketDataRequest) => ReturnType<MarketDataProvider['fetch']>;
  }>
): MarketDataProvider {
  return {
    sourceCode,
    capabilities: [
      {
        assetSubcategories: ['equity_br', '*'],
        fields: ['daily_close_price', 'client_quantity'],
        historical: true,
        realtime: false,
        priority: 10,
      },
    ],
    canHandle: async (req) => (handlers.canHandle ? handlers.canHandle(req) : true),
    fetch: async (req) => (handlers.fetch ? handlers.fetch(req) : []),
  };
}

describe('section21 validation gate (A-01 adversarial)', () => {
  it('singleton inicia vazio', () => {
    expect(marketDataProviderRegistry.listSourceCodes()).toEqual([]);
  });

  it('todo campo canonico tem escopo global ou tenant', () => {
    for (const field of CANONICAL_MARKET_FIELDS) {
      expect(['global', 'tenant']).toContain(MARKET_FIELD_SCOPE[field]);
    }
  });

  it('campo tenant sem organizationId gera invalid_request', async () => {
    const registry = new MarketDataProviderRegistry();
    registry.register(mockProvider('tenant_src', {}));
    const report = await registry.fetchWithPrecedence(
      {
        asOfDate: '2026-06-17',
        asset: { ticker: 'PRIO3', assetSubcategory: 'equity_br' },
        fields: ['client_quantity'],
      },
      ['tenant_src']
    );
    expect(report.results).toHaveLength(0);
    expect(report.failures[0]?.errorCode).toBe('invalid_request');
  });

  it('falha parcial nao impede segunda fonte', async () => {
    const registry = new MarketDataProviderRegistry();
    registry.register(
      mockProvider('failing', {
        fetch: async () => {
          throw new Error('HTTP 503');
        },
      })
    );
    registry.register(
      mockProvider('ok', {
        fetch: async (req) => [
          {
            asset: req.asset,
            field: 'daily_close_price',
            value: 42,
            asOfDate: req.asOfDate,
            sourceCode: 'ok',
            confidence: 'external',
          },
        ],
      })
    );
    const report = await registry.fetchWithPrecedence(
      {
        asOfDate: '2026-06-17',
        asset: { ticker: 'PRIO3', assetSubcategory: 'equity_br' },
        fields: ['daily_close_price'],
      },
      ['failing', 'ok']
    );
    expect(report.resolvedByField.daily_close_price?.value).toBe(42);
    expect(report.failures.some((f: MarketDataSourceFailure) => f.sourceCode === 'failing')).toBe(true);
  });

  it('versao de regras fallback congelada', () => {
    expect(MARKET_DATA_FALLBACK_RULES_VERSION).toBe('A-01');
  });
});
