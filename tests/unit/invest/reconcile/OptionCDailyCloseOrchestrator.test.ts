import type { CoCeoDataGateway, UserContext } from '../../../../src/core/dal';

const startSession = jest.fn();
const completePhase = jest.fn();
const getDay = jest.fn();
const reconcileCustody = jest.fn();
const importEntriesOnly = jest.fn();
const importAndApplyHomeBroker = jest.fn();
const applyBtgExtractBatchUpload = jest.fn();
const syncHistoricalFromBrapi = jest.fn();
const syncMissingOptions = jest.fn();
const rebuildPatrimony = jest.fn();
const buildNotesFileIndex = jest.fn();

jest.mock('../../../../src/core/invest/reconcile/ReconciliationSessionService', () => ({
  ReconciliationSessionService: jest.fn().mockImplementation(() => ({
    startSession,
    completePhase,
    getDay,
  })),
}));

jest.mock('../../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    reconcileCustody,
    importEntriesOnly,
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/HomeBrokerSnapshotUploadService', () => ({
  HomeBrokerSnapshotUploadService: jest.fn().mockImplementation(() => ({
    importAndApply: importAndApplyHomeBroker,
  })),
}));

jest.mock('../../../../src/core/invest/btgUploadImportService', () => ({
  applyBtgExtractBatchUpload,
}));

jest.mock('../../../../src/core/invest/InvestQuoteSyncService', () => ({
  InvestQuoteSyncService: jest.fn().mockImplementation(() => ({
    syncHistoricalFromBrapi,
  })),
}));

jest.mock('../../../../src/core/invest/OptionHistoricalSyncService', () => ({
  OptionHistoricalSyncService: jest.fn().mockImplementation(() => ({
    syncMissingOptions,
  })),
}));

jest.mock('../../../../src/core/invest/PatrimonyDailyRebuildService', () => ({
  PatrimonyDailyRebuildService: jest.fn().mockImplementation(() => ({
    rebuild: rebuildPatrimony,
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/DailyCloseMaterializeService', () => ({
  DailyCloseMaterializeService: jest.fn().mockImplementation(() => ({
    materializeDay: jest.fn(),
  })),
}));

jest.mock('../../../../src/core/invest/HoldingPurgeKeepOpeningService', () => ({
  HoldingPurgeKeepOpeningService: jest.fn().mockImplementation(() => ({
    purgeKeepOpening: jest.fn(),
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/reconcileNotesIndex', () => ({
  buildNotesFileIndex,
}));

import { OptionCDailyCloseOrchestrator } from '../../../../src/core/invest/reconcile/OptionCDailyCloseOrchestrator';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

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

describe('OptionCDailyCloseOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    startSession.mockResolvedValue({
      sessionId: 'sess-1',
      calendar: ['2026-01-02'],
      activityLog: [{ message: 'sessao iniciada' }],
      schemaApplied: true,
    });
    completePhase.mockResolvedValue({ completed: true });
    getDay.mockResolvedValue({
      canClose: true,
      pendingDecisions: [],
      blockReasons: [],
    });
    reconcileCustody.mockResolvedValue({ ok: true });
    importEntriesOnly.mockResolvedValue({ inserted: 1, skipped: 0, enriched: 0 });
    importAndApplyHomeBroker.mockResolvedValue({
      filesTotal: 1,
      snapshotsImported: 1,
      snapshotsApplied: 1,
      anchorsUpserted: 1,
      warnings: [],
      appliedDates: ['2026-01-02'],
    });
    applyBtgExtractBatchUpload.mockResolvedValue({
      fileResults: [{ importOk: true }],
      totals: { inserted: 2, skipped: 0 },
      chainOk: true,
    });
    syncHistoricalFromBrapi.mockResolvedValue(4);
    syncMissingOptions.mockResolvedValue({ synced: 2, missing: 0 });
    rebuildPatrimony.mockImplementation(async (_ctx, opts) => {
      opts?.onProgress?.(1, 0, '2026-01-02');
      return { daysWritten: 1, daysSkipped: 0, threePricesUpdated: 1, warnings: [] };
    });
    buildNotesFileIndex.mockResolvedValue({
      calendar: ['2026-01-02'],
      noteLinesByDate: {},
      linesByRowKey: new Map([
        [
          'note:1:2026-01-02:1',
          {
            date: '2026-01-02',
            ticker: 'PRIO3',
            quantity: 100,
            unit_price: 40,
            operation: 'buy',
            broker_note_ref: 'BTG-NOTA-1',
          },
        ],
      ]),
    });
  });

  it('processa os 3 grupos da interface e atualiza financeiro, custodia, cotacoes, opcoes e patrimonio', async () => {
    const notesFiles = [{ name: 'notas/jan.pdf', contentBase64: 'cGRm' }];
    const extractFiles = [{ name: 'extratos/jan.txt', contentBase64: 'dHh0' }];
    const homeBrokerFiles = [{ name: 'homebroker/snapshot.json', contentBase64: 'e30=' }];
    const service = new OptionCDailyCloseOrchestrator(mockGateway());

    const finalState = await service.runAll(
      ctx,
      {
        notesFiles,
        extractFiles,
        homeBrokerFiles,
        mode: 'homologation',
        delayMs: 0,
      }
    );

    expect(finalState.phase).toBe('done');
    expect(finalState.extractPending).toBe(false);
    expect(finalState.homeBrokerImport).toMatchObject({
      snapshotsImported: 1,
      snapshotsApplied: 1,
      anchorsUpserted: 1,
    });
    expect(startSession).toHaveBeenCalledWith(ctx, expect.objectContaining({ phase: 'notes', files: notesFiles }));
    expect(importAndApplyHomeBroker).toHaveBeenCalledWith(ctx, homeBrokerFiles);
    expect(reconcileCustody).toHaveBeenCalledWith(ctx);
    expect(importEntriesOnly).toHaveBeenCalledWith(
      ctx,
      [expect.objectContaining({ ticker: 'PRIO3', date: '2026-01-02' })],
      { sourceLabel: 'option_c_notes_day' }
    );
    expect(applyBtgExtractBatchUpload).toHaveBeenCalledWith(ctx, expect.any(Object), extractFiles);
    expect(syncHistoricalFromBrapi).toHaveBeenCalledWith(ctx);
    expect(syncMissingOptions).toHaveBeenCalledWith(ctx);
    expect(rebuildPatrimony).toHaveBeenCalledWith(ctx, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(finalState.activityLog.join('\n')).toContain('Rebuild: 1 dia(s) gravados');
  });
});
