import { BusinessEventRegistry } from '../../../../src/core/business-events';
import type { UserContext } from '../../../../src/core/dal';
import { InMemoryGateway, castGateway } from './inMemoryGateway';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

function makeRegistry() {
  const gw = new InMemoryGateway();
  const reg = new BusinessEventRegistry(castGateway(gw));
  return { gw, reg };
}

describe('BusinessEventRegistry', () => {
  it('create grava header com revision_no=1 e ID gerado', async () => {
    const { reg, gw } = makeRegistry();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      settlesOn: '2026-04-22',
      sourceRef: 'NOTA-12345',
      sourceSystem: 'btg_brokerage_note_parser',
      totalNet: -821929.04,
    });
    expect(ev.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ev.revision_no).toBe(1);
    expect(ev.source_ref).toBe('NOTA-12345');
    expect(ev.total_net).toBe(-821929.04);
    expect(gw.count('business_events')).toBe(1);
  });

  it('ensureByRef eh idempotente para mesmo source_ref', async () => {
    const { reg, gw } = makeRegistry();
    const a = await reg.ensureByRef(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-77',
      sourceSystem: 'parser',
    });
    expect(a.created).toBe(true);

    const b = await reg.ensureByRef(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-77',
      sourceSystem: 'parser',
    });
    expect(b.created).toBe(false);
    expect(b.event.id).toBe(a.event.id);
    expect(gw.count('business_events')).toBe(1);
  });

  it('ensureByRef sem source_ref cria header avulso (nunca idempotente)', async () => {
    const { reg, gw } = makeRegistry();
    await reg.ensureByRef(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'cash_movement',
      occurredOn: '2026-05-01',
      sourceSystem: 'extrato_btg',
    });
    await reg.ensureByRef(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'cash_movement',
      occurredOn: '2026-05-01',
      sourceSystem: 'extrato_btg',
    });
    expect(gw.count('business_events')).toBe(2);
  });

  it('amend cria revision_no=2 apontando o anterior via supersedes_event_id', async () => {
    const { reg } = makeRegistry();
    const v1 = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-9',
      sourceSystem: 'parser',
      totalNet: -100,
    });
    const v2 = await reg.amend(ctx, v1.id, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-9',
      sourceSystem: 'parser',
      totalNet: -150,
    });
    expect(v2.revision_no).toBe(2);
    expect(v2.supersedes_event_id).toBe(v1.id);
    expect(v2.total_net).toBe(-150);
  });

  it('voidEvent marca voided_at e void_reason sem deletar o header', async () => {
    const { reg, gw } = makeRegistry();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-X',
      sourceSystem: 'parser',
    });
    await reg.voidEvent(ctx, ev.id, 'u-admin', 'cancelado pela B3');
    const after = await reg.findById(ctx, ev.id);
    expect(after?.voided_at).toBeTruthy();
    expect(after?.voided_by_user_id).toBe('u-admin');
    expect(after?.void_reason).toBe('cancelado pela B3');
    expect(gw.count('business_events')).toBe(1);
  });

  it('listRevisions devolve cadeia ordenada por revision_no e findHead pega a ponta', async () => {
    const { reg } = makeRegistry();
    const v1 = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-CHAIN',
      sourceSystem: 'parser',
    });
    const v2 = await reg.amend(ctx, v1.id, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-CHAIN',
      sourceSystem: 'parser',
    });
    const v3 = await reg.amend(ctx, v2.id, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-CHAIN',
      sourceSystem: 'parser',
    });
    const chain = await reg.listRevisions(ctx, 'INVEST', 'NOTA-CHAIN');
    expect(chain.map((c) => c.revision_no)).toEqual([1, 2, 3]);
    expect(chain.map((c) => c.id)).toEqual([v1.id, v2.id, v3.id]);

    const head = await reg.findHead(ctx, 'INVEST', 'NOTA-CHAIN');
    expect(head?.id).toBe(v3.id);
  });

  it('listLegs agrega patrimony + financial pernas vinculadas (ordenadas por data)', async () => {
    const { reg, gw } = makeRegistry();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-LEGS',
      sourceSystem: 'parser',
    });
    await gw.insert(ctx, 'patrimony_ledger_entries', {
      id: 'leg-p-2',
      patrimony_item_id: 'item-a',
      business_event_id: ev.id,
      transaction_date: '2026-04-18',
      movement_type: 'acquisition',
    });
    await gw.insert(ctx, 'patrimony_ledger_entries', {
      id: 'leg-p-1',
      patrimony_item_id: 'item-a',
      business_event_id: ev.id,
      transaction_date: '2026-04-17',
      movement_type: 'acquisition',
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'leg-f-1',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 821929.04,
      status: 'cleared',
    });
    const legs = await reg.listLegs(ctx, ev.id);
    expect(legs.patrimonyLegs.map((l) => l.id)).toEqual(['leg-p-1', 'leg-p-2']);
    expect(legs.financialLegs.map((l) => l.id)).toEqual(['leg-f-1']);
  });

  it('findByLegId navega da perna patrimony de volta pro header', async () => {
    const { reg, gw } = makeRegistry();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-BACK',
      sourceSystem: 'parser',
    });
    await gw.insert(ctx, 'patrimony_ledger_entries', {
      id: 'leg-back',
      patrimony_item_id: 'item-x',
      business_event_id: ev.id,
      transaction_date: '2026-04-17',
      movement_type: 'acquisition',
    });
    const back = await reg.findByLegId(ctx, 'leg-back', 'patrimony');
    expect(back?.id).toBe(ev.id);
  });

  it('findByLegId retorna null para perna sem business_event_id (pre-migracao)', async () => {
    const { reg, gw } = makeRegistry();
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'leg-orphan',
      account_id: 'acc-1',
      business_event_id: null,
      transaction_date: '2025-12-31',
      direction: 'in',
      amount: 100,
    });
    const back = await reg.findByLegId(ctx, 'leg-orphan', 'financial');
    expect(back).toBeNull();
  });
});
