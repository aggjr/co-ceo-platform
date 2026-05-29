import type { CoCeoDataGateway } from '../../../../src/core/dal';
import type { UserContext } from '../../../../src/core/dal';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

const listLedgerEvents = jest.fn();
const importEntriesOnly = jest.fn();
const reconcileCustody = jest.fn();
const auditRun = jest.fn();
const createSession = jest.fn();
const getById = jest.fn();
const updateSession = jest.fn();
const appendDayLog = jest.fn();
const invalidateFromDate = jest.fn();
const recordDay = jest.fn();

jest.mock('../../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    listLedgerEvents,
    importEntriesOnly,
    reconcileCustody,
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/ReconciliationAuditService', () => ({
  ReconciliationAuditService: jest.fn().mockImplementation(() => ({
    run: auditRun,
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/ReconciliationSessionStore', () => ({
  ReconciliationSessionStore: jest.fn().mockImplementation(() => ({
    createSession,
    getById,
    updateSession,
    appendDayLog,
  })),
}));

jest.mock('../../../../src/core/invest/PatrimonyDailyStore', () => ({
  PatrimonyDailyStore: jest.fn().mockImplementation(() => ({
    invalidateFromDate,
    loadRange: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../../../src/core/invest/PatrimonyDailyRecorder', () => ({
  PatrimonyDailyRecorder: jest.fn().mockImplementation(() => ({
    recordDay,
  })),
}));

jest.mock('../../../../src/core/invest/PatrimonyDailyRebuildService', () => ({
  PatrimonyDailyRebuildService: jest.fn().mockImplementation(() => ({
    rebuild: jest.fn(),
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/reconcileNotesIndex', () => ({
  buildNotesFileIndex: jest.fn().mockResolvedValue({
    calendar: ['2026-01-02'],
    noteLinesByDate: {
      '2026-01-02': [
        {
          rowKey: 'note:1:2026-01-02:1',
          noteNumber: '1',
          pregaoDate: '2026-01-02',
          ticker: 'PRIO3',
          quantity: 100,
          unitPrice: 40,
          operation: 'buy',
          status: 'file_only',
        },
      ],
    },
    linesByRowKey: new Map([
      [
        'note:1:2026-01-02:1',
        {
          ticker: 'PRIO3',
          quantity: 100,
          unit_price: 40,
          transaction_date: '2026-01-02',
          operation: 'buy',
          broker_note_ref: 'BTG-NOTA-1',
        },
      ],
    ]),
  }),
}));

jest.mock('../../../../src/core/invest/btgUploadImportService', () => ({
  previewBtgBrokerageUpload: jest.fn().mockResolvedValue({ kind: 'brokerage_notes' }),
}));

jest.mock('../../../../src/core/invest/HoldingPurgeKeepOpeningService', () => ({
  HoldingPurgeKeepOpeningService: jest.fn().mockImplementation(() => ({
    preflight: jest.fn().mockResolvedValue({ needsDataModeChoice: false }),
    purgeKeepOpening: jest.fn(),
  })),
}));

import { ReconciliationSessionService } from '../../../../src/core/invest/reconcile/ReconciliationSessionService';

function mockGateway(): CoCeoDataGateway {
  return {
    findWhere: jest.fn().mockResolvedValue([]),
    insert: jest.fn(),
    readQuery: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    deleteMatching: jest.fn(),
    transaction: jest.fn(),
    getOrganizationStorage: jest.fn(),
    recordTelemetryEvents: jest.fn(),
  } as unknown as CoCeoDataGateway;
}

describe('ReconciliationSessionService', () => {
  beforeEach(() => {
    listLedgerEvents.mockReset();
    importEntriesOnly.mockReset();
    reconcileCustody.mockReset();
    auditRun.mockReset();
    createSession.mockReset();
    getById.mockReset();
    updateSession.mockReset();

    let ledgerCalls = 0;
    listLedgerEvents.mockImplementation(async () => {
      ledgerCalls += 1;
      if (ledgerCalls <= 2) return [];
      return [
        {
          id: 'leg-1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'buy',
          transaction_date: '2026-01-02',
          quantity: 100,
          unit_price: 40,
          total_net_value: -4000,
        },
      ];
    });
    importEntriesOnly.mockResolvedValue({ inserted: 1, skipped: 0, enriched: 0 });
    reconcileCustody.mockResolvedValue({ ok: true });
    auditRun.mockResolvedValue({
      canProceedToNextDay: true,
      pendingDecisions: [],
      issues: [],
      countsBySeverity: { info: 0, warn: 0, error: 0, critical: 0 },
      runAt: new Date().toISOString(),
    });
    createSession.mockResolvedValue({
      id: 'sess-1',
      organization_id: 'org-holding-001',
      phase: 'notes',
      status: 'in_progress',
      horizon_trusted_through: null,
      file_index: {},
      progress_by_day: {},
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    });
    getById.mockImplementation(async () => ({
      id: 'sess-1',
      organization_id: 'org-holding-001',
      phase: 'notes',
      status: 'in_progress',
      horizon_trusted_through: null,
      file_index: {},
      progress_by_day: {},
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }));
    updateSession.mockImplementation(async (_c, _id, patch) => ({
      id: 'sess-1',
      organization_id: 'org-holding-001',
      phase: 'notes',
      status: 'in_progress',
      horizon_trusted_through: patch.horizon_trusted_through ?? null,
      file_index: {},
      progress_by_day: patch.progress_by_day ?? {},
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }));
    recordDay.mockResolvedValue({});
    invalidateFromDate.mockResolvedValue(undefined);
  });

  it('close retorna 409 com file_only pendente', async () => {
    const service = new ReconciliationSessionService(mockGateway());
    const started = await service.startSession(ctx, {
      phase: 'notes',
      files: [{ name: 'n.pdf', contentBase64: 'cGRm' }],
    });

    await expect(service.closeDay(ctx, started.sessionId, '2026-01-02')).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  it('resolve insert permite close', async () => {
    const service = new ReconciliationSessionService(mockGateway());
    const started = await service.startSession(ctx, {
      phase: 'notes',
      files: [{ name: 'n.pdf', contentBase64: 'cGRm' }],
    });

    const day = await service.getDay(ctx, started.sessionId, '2026-01-02');
    expect(day.canClose).toBe(false);

    const after = await service.resolveDecision(ctx, started.sessionId, '2026-01-02', {
      decisionId: day.pendingDecisions[0]!.decisionId,
      action: 'insert_from_file',
    });
    expect(after.canClose).toBe(true);

    const closed = await service.closeDay(ctx, started.sessionId, '2026-01-02');
    expect(closed.closed).toBe(true);
    expect(closed.horizon).toBe('2026-01-02');
  });
});
