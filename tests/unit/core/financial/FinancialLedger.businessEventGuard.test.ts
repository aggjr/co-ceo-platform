import type { UserContext } from '../../../../src/core/dal';
import { BusinessEventReconciler } from '../../../../src/core/business-events/BusinessEventReconciler';
import { FinancialLedger } from '../../../../src/core/financial/FinancialLedger';
import {
  InMemoryGateway,
  castGateway,
} from '../business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-test-001',
  impersonatorId: null,
  scope: 'node',
};

describe('FinancialLedger business-event guards', () => {
  it('defaults new cash legs to pending when status is omitted', async () => {
    const gw = new InMemoryGateway();
    const settlementEngine = {
      resolveSettlementDate: jest.fn().mockResolvedValue('2026-01-03'),
    };
    const ledger = new FinancialLedger(castGateway(gw), settlementEngine as never);

    await ledger.record(ctx, {
      accountId: 'acc-1',
      transactionDate: '2026-01-02',
      direction: 'in',
      amount: 100,
      businessEventId: 'be-1',
    });

    const [leg] = gw.dump('financial_ledger_entries');
    expect(leg!.status).toBe('pending');
  });

  it('auditoria trata business_event_id legado sentinela como orfao', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'patrimony_ledger_entries', {
      id: 'ple-legacy',
      patrimony_item_id: 'item-1',
      transaction_date: '2026-01-02',
      movement_type: 'acquisition',
      quantity_delta: 1,
      unit_value: 10,
      business_event_id: '__legacy_missing_business_event__',
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'fle-legacy',
      account_id: 'acc-1',
      transaction_date: '2026-01-02',
      settlement_date: '2026-01-02',
      direction: 'out',
      amount: 10,
      status: 'pending',
      business_event_id: '__legacy_missing_business_event__',
    });

    const reconciler = new BusinessEventReconciler(gateway, {} as never);
    const orphans = await reconciler.findOrphanLegs(ctx);

    expect(orphans.patrimony.map((r) => r.id)).toContain('ple-legacy');
    expect(orphans.financial.map((r) => r.id)).toContain('fle-legacy');
  });
});
