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
const reconcileEconomicConservation = jest.fn();

jest.mock('../../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    listLedgerEvents,
  })),
}));

jest.mock('../../../../src/core/business-events/BusinessEventReconciler', () => ({
  BusinessEventReconciler: jest.fn().mockImplementation(() => ({
    findOrphanLegs,
    reconcileEvent,
    reconcileEconomicConservation,
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

function mockGatewayWithBusinessEvents(rows: Record<string, unknown>[]): CoCeoDataGateway {
  const gateway = mockGateway() as CoCeoDataGateway & { findWhere: jest.Mock };
  gateway.findWhere.mockImplementation((_ctx, table) => {
    if (table === 'business_events') return Promise.resolve(rows);
    if (table === 'patrimony_items') return Promise.resolve([]);
    return Promise.resolve([]);
  });
  return gateway;
}

describe('ReconciliationAuditService', () => {
  beforeEach(() => {
    listLedgerEvents.mockReset();
    findOrphanLegs.mockReset();
    reconcileEvent.mockReset();
    reconcileEconomicConservation.mockReset();
    findOrphanLegs.mockResolvedValue({ patrimony: [], financial: [] });
    reconcileEvent.mockResolvedValue({ consistent: true, issues: [] });
    reconcileEconomicConservation.mockResolvedValue({
      conserved: true,
      skipped: true,
      issues: [],
    });
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
  it('bloqueia evento de negocio com composicao incompleta ou divergente', async () => {
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
        business_event_id: 'opening-event',
      },
      {
        id: 'b1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-02',
        quantity: 10,
        unit_price: 42,
        total_net_value: -420,
        impacts_managerial_price: true,
        business_event_id: 'bad-event',
      },
    ]);
    reconcileEvent.mockResolvedValueOnce({
      consistent: false,
      issues: ['Soma das pernas de caixa (-400) nao bate com header.total_net (-420). delta=20'],
      delta: 20,
    });

    const service = new ReconciliationAuditService(
      mockGatewayWithBusinessEvents([
        {
          id: 'bad-event',
          occurred_on: '2026-01-02',
          voided_at: null,
        },
      ])
    );
    const report = await service.run(ctx);

    expect(report.canProceedToNextDay).toBe(false);
    expect(report.issues.some((i) => i.kind === 'legs_sum_mismatch')).toBe(true);
    expect(report.pendingDecisions.some((d) => d.kind === 'legs_sum_mismatch')).toBe(true);
  });
});
