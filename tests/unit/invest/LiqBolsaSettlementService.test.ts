import type { UserContext } from '../../../src/core/dal';
import { LiqBolsaSettlementService } from '../../../src/core/invest/LiqBolsaSettlementService';
import {
  InMemoryGateway,
  castGateway,
} from '../core/business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-test-001',
  impersonatorId: null,
  scope: 'node',
};

describe('LiqBolsaSettlementService', () => {
  it('liquida pendencias de eventos de nota e cancela expectativas pending', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'business_events', {
      id: 'be-buy',
      source_ref: 'BTG-NOTA-1',
      event_kind: 'broker_note_spot',
      occurred_on: '2026-01-05',
      settles_on: '2026-01-07',
      total_net: -1000,
    });
    await gateway.insert(ctx, 'business_events', {
      id: 'be-sell',
      source_ref: 'BTG-NOTA-2',
      event_kind: 'broker_note_spot',
      occurred_on: '2026-01-05',
      settles_on: '2026-01-07',
      total_net: 300,
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-buy',
      account_id: 'acc-1',
      business_event_id: 'be-buy',
      transaction_date: '2026-01-05',
      settlement_date: '2026-01-07',
      direction: 'out',
      amount: 1000,
      status: 'pending',
      external_ref: 'AUTO-D2:BUY',
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-sell',
      account_id: 'acc-1',
      business_event_id: 'be-sell',
      transaction_date: '2026-01-05',
      settlement_date: '2026-01-07',
      direction: 'in',
      amount: 300,
      status: 'pending',
      external_ref: 'AUTO-D2:SELL',
    });

    const result = await new LiqBolsaSettlementService(gateway).settle(ctx, {
      extractLineRef: 'BTG-EXT-2026-01-07#01',
      settlementDate: '2026-01-07',
      valueSignedCents: -70000,
    });

    expect(result.status).toBe('matched');
    const legs = gw.dump('financial_ledger_entries');
    expect(legs.filter((l) => l.status === 'cleared')).toHaveLength(2);
    expect(legs.find((l) => l.id === 'pending-buy')!.status).toBe('cancelled');
    expect(legs.find((l) => l.id === 'pending-sell')!.status).toBe('cancelled');
    expect(
      legs
        .filter((l) => l.status === 'cleared')
        .map((l) => l.external_ref)
        .sort()
    ).toEqual([
      'BTG-EXT-2026-01-07#01#BTG-NOTA-1',
      'BTG-EXT-2026-01-07#01#BTG-NOTA-2',
    ]);
  });

  it('bloqueia LIQ BOLSA sem subconjunto exato', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'business_events', {
      id: 'be-buy',
      source_ref: 'BTG-NOTA-1',
      event_kind: 'broker_note_spot',
      occurred_on: '2026-01-05',
      settles_on: '2026-01-07',
      total_net: -1000,
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-buy',
      account_id: 'acc-1',
      business_event_id: 'be-buy',
      transaction_date: '2026-01-05',
      settlement_date: '2026-01-07',
      direction: 'out',
      amount: 1000,
      status: 'pending',
      external_ref: 'AUTO-D2:BUY',
    });

    const result = await new LiqBolsaSettlementService(gateway).settle(ctx, {
      extractLineRef: 'BTG-EXT-2026-01-07#01',
      settlementDate: '2026-01-07',
      valueSignedCents: -99900,
    });

    expect(result.status).toBe('blocked');
    expect(gw.dump('financial_ledger_entries').filter((l) => l.status === 'cleared')).toHaveLength(0);
    expect(gw.dump('financial_ledger_entries')[0]!.status).toBe('pending');
  });
});
