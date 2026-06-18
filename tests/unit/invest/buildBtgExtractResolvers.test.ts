import { buildBtgExtractResolvers } from '../../../src/core/invest/buildBtgExtractResolvers';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('buildBtgExtractResolvers', () => {
  const events: LedgerEvent[] = [
    {
      asset_id: 'opt-sell-1',
      transaction_date: '2026-03-17',
      asset_ticker: 'PRIOR407',
      asset_type: 'option_put',
      transaction_type: 'put_sell',
      quantity: -6300,
      unit_price: 2.46,
      total_net_value: 15474.53,
    },
    {
      asset_id: 'stock-1',
      transaction_date: '2026-01-01',
      asset_ticker: 'PRIO3',
      asset_type: 'stock',
      transaction_type: 'opening_balance',
      quantity: 5400,
      unit_price: 40,
      total_net_value: 0,
    },
  ];

  it('resolveIrrfOpcaoTicker retorna ultima venda de opcao recente', () => {
    const resolvers = buildBtgExtractResolvers(events);
    const hit = resolvers.resolveIrrfOpcaoTicker?.('2026-03-18');
    expect(hit?.ticker).toBe('PRIOR407');
    expect(hit?.asset_type).toBe('option_put');
  });

  it('resolveNegativeBalanceAllocation pondera por posicao aberta', () => {
    const resolvers = buildBtgExtractResolvers(events);
    const alloc = resolvers.resolveNegativeBalanceAllocation?.('2026-03-20');
    expect(alloc?.length).toBeGreaterThan(0);
    const sum = (alloc ?? []).reduce((s, row) => s + row.weight, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it('resolveCustodyFeeAllocation usa mesma base de valor em custodia', () => {
    const resolvers = buildBtgExtractResolvers(events);
    const alloc = resolvers.resolveCustodyFeeAllocation?.('2026-03-20');
    expect(alloc?.length).toBeGreaterThan(0);
    expect(alloc?.some((r) => r.ticker === 'PRIO3')).toBe(true);
  });
});
