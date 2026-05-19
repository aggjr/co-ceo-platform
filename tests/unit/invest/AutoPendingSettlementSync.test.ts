import {
  autoD2Ref,
  syncAutoPendingSettlements,
} from '../../../src/core/invest/AutoPendingSettlementSync';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('AutoPendingSettlementSync', () => {
  it('autoD2Ref is stable', () => {
    expect(autoD2Ref('led-abc')).toBe('AUTO-D2:led-abc');
  });

  it('creates pending_settlement for open stock buy', async () => {
    const inserts: unknown[] = [];
    const gateway = {
      insert: async (_ctx: unknown, _table: string, row: unknown) => {
        inserts.push(row);
      },
    };

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
      gateway as never,
      {} as never,
      events,
      {
        today: '2026-05-15',
        orgId: 'org-1',
        cashAssetId: 'cash-1',
      }
    );

    expect(result.created).toBe(1);
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as { transaction_type: string; total_net_value: number };
    expect(row.transaction_type).toBe('pending_settlement');
    expect(row.total_net_value).toBe(-5000);
  });
});
