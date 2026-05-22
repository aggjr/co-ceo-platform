import {
  BusinessEventRegistry,
  BusinessEventReconciler,
} from '../../../../src/core/business-events';
import type { UserContext } from '../../../../src/core/dal';
import { InMemoryGateway, castGateway } from './inMemoryGateway';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

function makeTriple() {
  const gw = new InMemoryGateway();
  const reg = new BusinessEventRegistry(castGateway(gw));
  const rec = new BusinessEventReconciler(castGateway(gw), reg);
  return { gw, reg, rec };
}

describe('BusinessEventReconciler', () => {
  it('header coerente com soma das pernas de caixa => consistent=true', async () => {
    const { gw, reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-OK',
      sourceSystem: 'parser',
      totalNet: -1000,
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f1',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'in',
      amount: 200,
      status: 'cleared',
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f2',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 1200,
      status: 'cleared',
    });
    const report = await rec.reconcileEvent(ctx, ev.id);
    expect(report.consistent).toBe(true);
    expect(report.totalNetLegs).toBe(-1000);
    expect(report.delta).toBe(0);
    expect(report.financialLegCount).toBe(2);
  });

  it('pernas que nao batem com header => consistent=false com delta calculado', async () => {
    const { gw, reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-BAD',
      sourceSystem: 'parser',
      totalNet: -1000,
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f1',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 800,
      status: 'cleared',
    });
    const report = await rec.reconcileEvent(ctx, ev.id);
    expect(report.consistent).toBe(false);
    expect(report.totalNetLegs).toBe(-800);
    expect(report.delta).toBe(200);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('status=cancelled nao entra na soma', async () => {
    const { gw, reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-CANC',
      sourceSystem: 'parser',
      totalNet: -500,
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f1',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 500,
      status: 'cleared',
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f-cancelled',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 999999,
      status: 'cancelled',
    });
    const report = await rec.reconcileEvent(ctx, ev.id);
    expect(report.totalNetLegs).toBe(-500);
    expect(report.consistent).toBe(true);
  });

  it('opening_balance (total_net=0) eh consistent quando tem pelo menos 1 perna', async () => {
    const { gw, reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'opening_balance',
      occurredOn: '2026-01-01',
      sourceRef: 'OPENING:2026-01-01',
      sourceSystem: 'bootstrap',
      totalNet: 0,
    });
    await gw.insert(ctx, 'patrimony_ledger_entries', {
      id: 'p1',
      patrimony_item_id: 'item-prio3',
      business_event_id: ev.id,
      transaction_date: '2026-01-01',
      movement_type: 'opening_balance',
    });
    const report = await rec.reconcileEvent(ctx, ev.id);
    expect(report.consistent).toBe(true);
    expect(report.patrimonyLegCount).toBe(1);
  });

  it('header sem pernas eh inconsistente', async () => {
    const { reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'cash_movement',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-EMPTY',
      sourceSystem: 'parser',
      totalNet: 0,
    });
    const report = await rec.reconcileEvent(ctx, ev.id);
    expect(report.consistent).toBe(false);
    expect(report.issues.some((i) => /sem pernas/i.test(i))).toBe(true);
  });

  it('assertConsistent lanca GatewayError 422 quando inconsistente', async () => {
    const { gw, reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-X',
      sourceSystem: 'parser',
      totalNet: -1000,
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f1',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 500,
      status: 'cleared',
    });
    await expect(rec.assertConsistent(ctx, ev.id)).rejects.toMatchObject({
      code: 'FINANCIAL_RULE_VIOLATION',
      httpStatus: 422,
    });
  });

  it('findOrphanLegs enxerga so pernas com business_event_id NULL no range', async () => {
    const { gw, rec } = makeTriple();
    // Orfa dentro do range
    await gw.insert(ctx, 'patrimony_ledger_entries', {
      id: 'p-orphan',
      patrimony_item_id: 'item-a',
      business_event_id: null,
      transaction_date: '2026-01-15',
      movement_type: 'opening_balance',
    });
    // Nao orfa (tem header)
    await gw.insert(ctx, 'patrimony_ledger_entries', {
      id: 'p-bound',
      patrimony_item_id: 'item-b',
      business_event_id: 'ev-1',
      transaction_date: '2026-01-15',
      movement_type: 'opening_balance',
    });
    // Orfa fora do range
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f-old',
      account_id: 'acc-1',
      business_event_id: null,
      transaction_date: '2024-01-01',
      direction: 'in',
      amount: 100,
    });
    // Orfa dentro do range
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f-orphan',
      account_id: 'acc-1',
      business_event_id: null,
      transaction_date: '2026-02-01',
      direction: 'in',
      amount: 100,
    });

    const orphans = await rec.findOrphanLegs(ctx, {
      transactionDateFrom: '2026-01-01',
      transactionDateTo: '2026-12-31',
    });
    expect(orphans.patrimony.map((r) => r.id)).toEqual(['p-orphan']);
    expect(orphans.financial.map((r) => r.id)).toEqual(['f-orphan']);
  });

  it('findOrphanLegs exige organizationId', async () => {
    const { rec } = makeTriple();
    const noOrgCtx: UserContext = { ...ctx, organizationId: null };
    await expect(rec.findOrphanLegs(noOrgCtx)).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
  });

  it('header voided sinaliza inconsistencia mesmo se as pernas batem', async () => {
    const { gw, reg, rec } = makeTriple();
    const ev = await reg.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'broker_note_spot',
      occurredOn: '2026-04-17',
      sourceRef: 'NOTA-V',
      sourceSystem: 'parser',
      totalNet: -100,
    });
    await gw.insert(ctx, 'financial_ledger_entries', {
      id: 'f1',
      account_id: 'acc-1',
      business_event_id: ev.id,
      transaction_date: '2026-04-22',
      direction: 'out',
      amount: 100,
      status: 'cleared',
    });
    await reg.voidEvent(ctx, ev.id, 'u-admin', 'cancelado');
    const report = await rec.reconcileEvent(ctx, ev.id);
    expect(report.consistent).toBe(false);
    expect(report.issues.some((i) => /voided/i.test(i))).toBe(true);
  });
});
