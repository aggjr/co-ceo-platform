import type { UserContext } from '../../../src/core/dal';
import { LiqBolsaSettlementService, matchSignedCentsSubset, consumeSignedCentsSubset } from '../../../src/core/invest/LiqBolsaSettlementService';
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

  it('encontra candidatos pela perna pending mesmo com settles_on do header divergente', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'business_events', {
      id: 'be-multi',
      source_ref: 'B3-NOTA-99',
      event_kind: 'broker_note_option',
      occurred_on: '2026-01-02',
      settles_on: '2026-01-06',
      total_net: -500,
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-jan7',
      account_id: 'acc-1',
      business_event_id: 'be-multi',
      transaction_date: '2026-01-02',
      settlement_date: '2026-01-07',
      direction: 'out',
      amount: 1797.6,
      status: 'pending',
      external_ref: 'BROKER_REF:B3-NOTA-99#2026-01-02#1:PENDING',
    });

    const result = await new LiqBolsaSettlementService(gateway).settle(ctx, {
      extractLineRef: 'BTG-EXT-2026-01-07#01',
      settlementDate: '2026-01-07',
      valueSignedCents: -179760,
    });

    expect(result.status).toBe('matched');
  });

  it('filtra candidatos pelo pregão quando tradeDate informado', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'business_events', {
      id: 'be-a',
      source_ref: 'B3-NOTA-A#1',
      event_kind: 'broker_note_spot',
      occurred_on: '2026-01-16',
      settles_on: '2026-01-20',
      total_net: 219983.99,
    });
    await gateway.insert(ctx, 'business_events', {
      id: 'be-b',
      source_ref: 'B3-NOTA-B#1',
      event_kind: 'broker_note_option',
      occurred_on: '2026-01-19',
      settles_on: '2026-01-20',
      total_net: 3495.32,
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-a',
      account_id: 'acc-1',
      business_event_id: 'be-a',
      transaction_date: '2026-01-16',
      settlement_date: '2026-01-20',
      direction: 'in',
      amount: 219983.99,
      status: 'pending',
      external_ref: 'PENDING-A',
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-b',
      account_id: 'acc-1',
      business_event_id: 'be-b',
      transaction_date: '2026-01-19',
      settlement_date: '2026-01-20',
      direction: 'in',
      amount: 3495.32,
      status: 'pending',
      external_ref: 'PENDING-B',
    });

    const result = await new LiqBolsaSettlementService(gateway).settle(ctx, {
      extractLineRef: 'BTG-EXT-2026-01-20#01',
      settlementDate: '2026-01-20',
      valueSignedCents: 21998399,
      tradeDate: '2026-01-16',
    });

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.settledEvents).toEqual(['be-a']);
    }
  });

  it('reaplicar mesma LIQ BOLSA ja liquidada retorna matched idempotente', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'cleared-liq',
      account_id: 'acc-1',
      business_event_id: 'be-old',
      transaction_date: '2026-04-01',
      settlement_date: '2026-04-01',
      direction: 'in',
      amount: 3503.68,
      status: 'cleared',
      external_ref: 'BTG-EXT-2026-04-01#01#BTG-NOTA-OLD',
      description: 'LIQ BOLSA',
      metadata: JSON.stringify({
        kind: 'liq_bolsa_settlement',
        extract_line_ref: 'BTG-EXT-2026-04-01#01',
        matched_business_event_id: 'be-old',
      }),
    });

    const result = await new LiqBolsaSettlementService(gateway).settle(ctx, {
      extractLineRef: 'BTG-EXT-2026-04-01#01',
      settlementDate: '2026-04-01',
      valueSignedCents: 350368,
    });

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') throw new Error('expected matched');
    expect(result.settledEvents).toEqual(['be-old']);
    expect(gw.dump('financial_ledger_entries')).toHaveLength(1);
  });

  it('matchSignedCentsSubset casa soma total ou subconjunto', () => {
    expect(matchSignedCentsSubset([-100000, 30000], -70000)).toBe(true);
    expect(matchSignedCentsSubset([-100000], -70000)).toBe(false);
    expect(matchSignedCentsSubset([], 100)).toBe(false);
  });

  it('consumeSignedCentsSubset remove candidatos casados do pool', () => {
    const consumed = consumeSignedCentsSubset([39948, 179760], 39948);
    expect(consumed?.remaining).toEqual([179760]);
  });

  it('encontra pending quando settlement_date vem como Date do MySQL', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'business_events', {
      id: 'be-date',
      source_ref: 'BTG-NOTA-DATE',
      event_kind: 'broker_note_option',
      occurred_on: '2026-01-05',
      settles_on: '2026-01-06',
      total_net: 399.48,
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-date',
      account_id: 'acc-1',
      business_event_id: 'be-date',
      transaction_date: new Date('2026-01-05T03:00:00.000Z'),
      settlement_date: new Date('2026-01-06T03:00:00.000Z'),
      direction: 'in',
      amount: 399.48,
      status: 'pending',
      external_ref: 'BROKER_REF:TEST:PENDING',
    });

    const result = await new LiqBolsaSettlementService(gateway).settle(ctx, {
      extractLineRef: 'BTG-EXT-DATE',
      settlementDate: '2026-01-06',
      valueSignedCents: 39948,
      tradeDate: '2026-01-05',
    });

    expect(result.status).toBe('matched');
  });
});
