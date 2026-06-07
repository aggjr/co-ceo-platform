import { ThreePricesContextFactory } from '../../../src/core/invest/ThreePricesContextFactory';

function makeMockGateway(assetRows: object[], ignoredRows: object[]) {
  return {
    findWhere: jest.fn().mockImplementation((_ctx: unknown, table: string) => {
      if (table === 'invest_asset_type_config') return Promise.resolve(assetRows);
      if (table === 'invest_ignored_tx_config') return Promise.resolve(ignoredRows);
      return Promise.resolve([]);
    }),
  };
}

describe('ThreePricesContextFactory', () => {
  const mockCtx = {} as any;

  it('classifica stock e fii como isStockLike', async () => {
    const gw = makeMockGateway(
      [
        { asset_type: 'stock', is_stock_like: 1, is_option_like: 0, is_active: 1 },
        { asset_type: 'fii',   is_stock_like: 1, is_option_like: 0, is_active: 1 },
      ],
      []
    );
    const factory = new ThreePricesContextFactory(gw as any);
    const ctx = await factory.build(mockCtx);
    expect(ctx.isStockLike('stock')).toBe(true);
    expect(ctx.isStockLike('fii')).toBe(true);
    expect(ctx.isStockLike('option_call')).toBe(false);
  });

  it('classifica option_call e option_put como isOptionLike', async () => {
    const gw = makeMockGateway(
      [
        { asset_type: 'option_call', is_stock_like: 0, is_option_like: 1, is_active: 1 },
        { asset_type: 'option_put',  is_stock_like: 0, is_option_like: 1, is_active: 1 },
      ],
      []
    );
    const factory = new ThreePricesContextFactory(gw as any);
    const ctx = await factory.build(mockCtx);
    expect(ctx.isOptionLike('option_call')).toBe(true);
    expect(ctx.isOptionLike('option_put')).toBe(true);
    expect(ctx.isStockLike('option_call')).toBe(false);
  });

  it('novos tipos (etf, bdr) entram via banco sem alterar codigo', async () => {
    const gw = makeMockGateway(
      [
        { asset_type: 'etf', is_stock_like: 1, is_option_like: 0, is_active: 1 },
        { asset_type: 'bdr', is_stock_like: 1, is_option_like: 0, is_active: 1 },
      ],
      []
    );
    const factory = new ThreePricesContextFactory(gw as any);
    const ctx = await factory.build(mockCtx);
    expect(ctx.isStockLike('etf')).toBe(true);
    expect(ctx.isStockLike('bdr')).toBe(true);
  });

  it('dividend e jcp retornam isIgnoredTransaction=true', async () => {
    const gw = makeMockGateway(
      [],
      [
        { operation_type: 'dividend', is_active: 1 },
        { operation_type: 'jcp',      is_active: 1 },
      ]
    );
    const factory = new ThreePricesContextFactory(gw as any);
    const ctx = await factory.build(mockCtx);
    expect(ctx.isIgnoredTransaction('dividend')).toBe(true);
    expect(ctx.isIgnoredTransaction('jcp')).toBe(true);
    expect(ctx.isIgnoredTransaction('buy')).toBe(false);
  });

  it('usa fallback seguro se tabelas nao existem', async () => {
    const gw = {
      findWhere: jest.fn().mockRejectedValue(new Error('table not found')),
    };
    const factory = new ThreePricesContextFactory(gw as any);
    const ctx = await factory.build(mockCtx);
    expect(ctx.isStockLike('stock')).toBe(true);
    expect(ctx.isOptionLike('option_call')).toBe(true);
    expect(ctx.isIgnoredTransaction('dividend')).toBe(true);
  });

  it('cache evita consulta dupla ao banco', async () => {
    const gw = makeMockGateway(
      [{ asset_type: 'stock', is_stock_like: 1, is_option_like: 0, is_active: 1 }],
      []
    );
    const factory = new ThreePricesContextFactory(gw as any);
    await factory.build(mockCtx);
    await factory.build(mockCtx);
    await factory.build(mockCtx);
    expect(gw.findWhere).toHaveBeenCalledTimes(2);
  });

  it('clearCache forca recarga', async () => {
    const gw = makeMockGateway(
      [{ asset_type: 'stock', is_stock_like: 1, is_option_like: 0, is_active: 1 }],
      []
    );
    const factory = new ThreePricesContextFactory(gw as any);
    await factory.build(mockCtx);
    factory.clearCache();
    await factory.build(mockCtx);
    expect(gw.findWhere).toHaveBeenCalledTimes(4);
  });
});
