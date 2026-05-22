import {
  autoD2Ref,
  syncAutoPendingSettlements,
} from '../../../src/core/invest/AutoPendingSettlementSync';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import type { InvestOperations } from '../../../src/modules/invest';

describe('AutoPendingSettlementSync', () => {
  it('autoD2Ref is stable', () => {
    expect(autoD2Ref('led-abc')).toBe('AUTO-D2:led-abc');
  });

  it('creates pending_settlement for open stock buy', async () => {
    const calls: Array<{ ticker: string; operation: string; total_net_value?: number }> = [];
    const operations = {
      recordOperation: async (_ctx: unknown, line: { ticker: string; operation: string; total_net_value?: number }) => {
        calls.push(line);
        return { skipped: false };
      },
    } as unknown as InvestOperations;

    const events: LedgerEvent[] = [
      {
        id: 'led-buy-1',
        transaction_date: '2026-05-15',
        asset_id: 'a1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 50,
        total_net_value: -5000,
      },
    ];

    const result = await syncAutoPendingSettlements(
      {} as never,
      {} as never,
      events,
      {
        today: '2026-05-15',
        operations,
      }
    );

    expect(result.created).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].operation).toBe('pending_settlement');
    expect(calls[0].total_net_value).toBe(-5000);
  });
});
