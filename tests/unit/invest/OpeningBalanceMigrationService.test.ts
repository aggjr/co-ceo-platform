import type { UserContext } from '../../../src/core/dal';
import {
  INVEST_OPENING_SOURCE_REF,
  OpeningBalanceMigrationService,
} from '../../../src/core/invest/OpeningBalanceMigrationService';
import { CashBalanceService } from '../../../src/core/invest/CashBalanceService';
import { LedgerImportService } from '../../../src/core/invest/LedgerImportService';
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

describe('OpeningBalanceMigrationService', () => {
  it('migra opening_balance para perna financeira de forma idempotente', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'financial_accounts', {
      id: 'acc-1',
      source_module: 'INVEST',
      account_type: 'brokerage',
      external_id: 'BTG',
      name: 'Caixa BTG',
      opening_balance: 1234.56,
      opening_date: '2026-01-01',
      status: 'active',
    });

    const service = new OpeningBalanceMigrationService(gateway);
    const first = await service.migrate(ctx);
    const second = await service.migrate(ctx);

    expect(first.legsCreated).toBe(1);
    expect(first.zeroed).toBe(1);
    expect(first.blocked).toHaveLength(0);
    expect(second.legsCreated).toBe(0);
    expect(second.legsAlreadyExisted).toBe(1);
    expect(second.blocked).toHaveLength(0);

    const account = gw.dump('financial_accounts')[0]!;
    expect(Number(account.opening_balance)).toBe(0);

    const events = gw.dump('business_events');
    expect(events).toHaveLength(1);
    expect(events[0]!.source_ref).toBe(INVEST_OPENING_SOURCE_REF);

    const legs = gw.dump('financial_ledger_entries');
    expect(legs).toHaveLength(1);
    expect(legs[0]!.business_event_id).toBe(events[0]!.id);
    expect(legs[0]!.direction).toBe('in');
    expect(Number(legs[0]!.amount)).toBeCloseTo(1234.56);

    await expect(new LedgerImportService(gateway).getOpeningLedgerBalance(ctx)).resolves.toBeCloseTo(
      1234.56
    );
  });

  it('bloqueia divergencia se a perna existente nao bate com opening_balance', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'financial_accounts', {
      id: 'acc-1',
      source_module: 'INVEST',
      account_type: 'brokerage',
      external_id: 'BTG',
      name: 'Caixa BTG',
      opening_balance: 200,
      opening_date: '2026-01-01',
      status: 'active',
    });

    const service = new OpeningBalanceMigrationService(gateway);
    await service.migrate(ctx);
    await gateway.update(ctx, 'financial_accounts', 'acc-1', { opening_balance: 201 });

    const report = await service.migrate(ctx);

    expect(report.blocked).toHaveLength(1);
    expect(report.blocked[0]!.reason).toContain('Perna de abertura divergente');
    expect(gw.dump('financial_ledger_entries')).toHaveLength(1);
  });
});

describe('CashBalanceService', () => {
  it('separa caixa liquidado, em transito e total gerencial', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'cleared-in',
      account_id: 'acc-1',
      transaction_date: '2026-01-02',
      settlement_date: '2026-01-02',
      direction: 'in',
      amount: 1000,
      status: 'cleared',
      business_event_id: 'be-1',
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-out',
      account_id: 'acc-1',
      transaction_date: '2026-01-03',
      settlement_date: '2026-01-06',
      direction: 'out',
      amount: 250,
      status: 'pending',
      business_event_id: 'be-2',
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'cancelled',
      account_id: 'acc-1',
      transaction_date: '2026-01-03',
      settlement_date: '2026-01-03',
      direction: 'out',
      amount: 100,
      status: 'cancelled',
      business_event_id: 'be-3',
    });

    const snapshot = await new CashBalanceService(gateway).getSnapshot(
      ctx,
      'acc-1',
      '2026-01-03'
    );

    expect(snapshot).toEqual({
      settledCash: 1000,
      inTransit: -250,
      cashWithTransit: 750,
    });

    const settledSnapshot = await new CashBalanceService(gateway).getSnapshot(
      ctx,
      'acc-1',
      '2026-01-06'
    );

    expect(settledSnapshot).toEqual({
      settledCash: 750,
      inTransit: 0,
      cashWithTransit: 750,
    });
  });
});
