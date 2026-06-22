import {
  MarketDataProviderDisabledError,
  MarketDataProviderNotRegisteredError,
  MarketDataProviderRegistry,
} from '../../../../src/core/market/MarketDataProviderRegistry';
import type {
  MarketDataProvider,
  MarketDataRequest,
  MarketDataResult,
} from '../../../../src/core/market/types';

function mockProvider(
  sourceCode: string,
  handlers: Partial<{
    canHandle: (req: MarketDataRequest) => boolean;
    fetch: (req: MarketDataRequest) => MarketDataResult[];
  }>
): MarketDataProvider {
  return {
    sourceCode,
    capabilities: [
      {
        assetSubcategories: ['equity_br', 'option_br', '*'],
        fields: [
          'daily_close_price',
          'contract_strike',
          'client_quantity',
        ],
        historical: true,
        realtime: false,
        priority: 10,
      },
    ],
    canHandle: async (req) =>
      handlers.canHandle ? handlers.canHandle(req) : true,
    fetch: async (req) => (handlers.fetch ? handlers.fetch(req) : []),
  };
}

const baseRequest: MarketDataRequest = {
  asOfDate: '2026-06-17',
  asset: { ticker: 'PRIO3', assetSubcategory: 'equity_br' },
  fields: ['daily_close_price'],
};

describe('MarketDataProviderRegistry (A-01)', () => {
  it('resolve provider registrado e rejeita desconhecido/desabilitado', () => {
    const registry = new MarketDataProviderRegistry();
    const provider = mockProvider('brapi', {});
    registry.register(provider);

    expect(registry.resolve('brapi')).toBe(provider);
    expect(() => registry.resolve('missing')).toThrow(MarketDataProviderNotRegisteredError);

    registry.setEnabled('brapi', false);
    expect(() => registry.resolve('brapi')).toThrow(MarketDataProviderDisabledError);
    expect(registry.tryResolve('brapi')).toBeNull();
  });

  it('fetchWithPrecedence tenta fontes em ordem até preencher campo', async () => {
    const registry = new MarketDataProviderRegistry();
    registry.register(
      mockProvider('failing', {
        fetch: () => {
          throw new Error('HTTP 503');
        },
      })
    );
    registry.register(
      mockProvider('brapi', {
        fetch: (req) => [
          {
            asset: req.asset,
            field: 'daily_close_price',
            value: 41.2,
            asOfDate: req.asOfDate,
            sourceCode: 'brapi',
            confidence: 'external',
          },
        ],
      })
    );

    const report = await registry.fetchWithPrecedence(baseRequest, [
      'failing',
      'brapi',
    ]);

    expect(report.results).toHaveLength(1);
    expect(report.resolvedByField.daily_close_price?.value).toBe(41.2);
    expect(report.missingFields).toHaveLength(0);
    expect(report.failures.some((f) => f.sourceCode === 'failing')).toBe(true);
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

  it('usa proxima fonte quando anterior nao retorna dado', async () => {
    const registry = new MarketDataProviderRegistry();
    registry.register(mockProvider('empty', { fetch: () => [] }));
    registry.register(
      mockProvider('brapi', {
        fetch: (req) => [
          {
            asset: req.asset,
            field: 'daily_close_price',
            value: 41,
            asOfDate: req.asOfDate,
            sourceCode: 'brapi',
            confidence: 'external',
          },
        ],
      })
    );

    const report = await registry.fetchWithPrecedence(baseRequest, ['empty', 'brapi']);
    expect(report.resolvedByField.daily_close_price?.value).toBe(41);
    expect(report.resolvedByField.daily_close_price?.sourceCode).toBe('brapi');
    expect(report.failures.some((f) => f.sourceCode === 'empty' && f.errorCode === 'no_data')).toBe(
      true
    );
  });

  it('fieldsForSource reflete capabilities declaradas', () => {
    const registry = new MarketDataProviderRegistry();
    registry.register(mockProvider('brapi', {}));
    expect(registry.fieldsForSource('brapi', 'equity_br')).toContain(
      'daily_close_price'
    );
    expect(registry.fieldsForSource('missing', 'equity_br')).toEqual([]);
  });
});
