import { ReconciliationAuditService } from '../../../../src/core/invest/reconcile/ReconciliationAuditService';
import type { CoCeoDataGateway } from '../../../../src/core/dal';
import type { UserContext } from '../../../../src/core/dal';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

const listLedgerEvents = jest.fn();
const findOrphanLegs = jest.fn();
const reconcileEvent = jest.fn();

jest.mock('../../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    listLedgerEvents,
  })),
}));

jest.mock('../../../../src/core/business-events/BusinessEventReconciler', () => ({
  BusinessEventReconciler: jest.fn().mockImplementation(() => ({
    findOrphanLegs,
    reconcileEvent,
  })),
}));

jest.mock('../../../../src/core/business-events/BusinessEventRegistry', () => ({
  BusinessEventRegistry: jest.fn(),
}));

jest.mock('../../../../src/core/invest/PatrimonyDailyStore', () => ({
  PatrimonyDailyStore: jest.fn().mockImplementation(() => ({
    loadRange: jest.fn().mockResolvedValue([]),
  })),
}));

function mockGateway(): CoCeoDataGateway {
  return {
    findWhere: jest.fn().mockResolvedValue([]),
    insert: jest.fn(),
    readQuery: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    update: jest.fn(),
    deleteMatching: jest.fn(),
    transaction: jest.fn(),
    softDelete: jest.fn(),
    getOrganizationStorage: jest.fn(),
    recordTelemetryEvents: jest.fn(),
  } as unknown as CoCeoDataGateway;
}

describe('ReconciliationAuditService', () => {
  beforeEach(() => {
    listLedgerEvents.mockReset();
    findOrphanLegs.mockReset();
    reconcileEvent.mockReset();
    findOrphanLegs.mockResolvedValue({ patrimony: [], financial: [] });
    reconcileEvent.mockResolvedValue({ consistent: true, issues: [] });
  });

  it('canProceedToNextDay quando livro limpo', async () => {
    listLedgerEvents.mockResolvedValue([
      {
        id: 'o1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
        impacts_managerial_price: true,
      },
    ]);

    const service = new ReconciliationAuditService(mockGateway());
    const report = await service.run(ctx);

    expect(report.canProceedToNextDay).toBe(true);
    expect(report.pendingDecisions).toHaveLength(0);
  });

  it('bloqueia quando há perna órfã', async () => {
    listLedgerEvents.mockResolvedValue([
      {
        id: 'o1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
        impacts_managerial_price: true,
      },
    ]);
    findOrphanLegs.mockResolvedValue({
      patrimony: [{ id: 'ple-1', transaction_date: '2026-01-02' }],
      financial: [],
    });

    const service = new ReconciliationAuditService(mockGateway());
    const report = await service.run(ctx);

    expect(report.canProceedToNextDay).toBe(false);
    expect(report.pendingDecisions.length).toBeGreaterThan(0);
    expect(report.pendingDecisions[0]!.allowedActions).not.toContain('insert_from_file');
  });

  it('critical quando não há abertura', async () => {
    listLedgerEvents.mockResolvedValue([]);

    const service = new ReconciliationAuditService(mockGateway());
    const report = await service.run(ctx);

    expect(report.canProceedToNextDay).toBe(false);
    expect(report.pendingDecisions.some((d) => d.severity === 'critical')).toBe(true);
  });
});
