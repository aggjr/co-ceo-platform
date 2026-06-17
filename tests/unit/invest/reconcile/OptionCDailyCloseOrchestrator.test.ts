import type { CoCeoDataGateway, UserContext } from '../../../../src/core/dal';

const startSession = jest.fn();
const importAndApplyHomeBroker = jest.fn();
const applyBtgMonthImport = jest.fn();
const discoverMonthExtractPlan = jest.fn();
const monthBounds = jest.fn();
const syncHistoricalFromBrapi = jest.fn();
const syncMissingOptions = jest.fn();
const rebuildPatrimony = jest.fn();
const reconcileCustody = jest.fn();

jest.mock('../../../../src/core/invest/reconcile/ReconciliationSessionService', () => ({
  ReconciliationSessionService: jest.fn().mockImplementation(() => ({
    startSession,
  })),
}));

jest.mock('../../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    reconcileCustody,
  })),
}));

jest.mock('../../../../src/core/invest/reconcile/HomeBrokerSnapshotUploadService', () => ({
  HomeBrokerSnapshotUploadService: jest.fn().mockImplementation(() => ({
    importAndApply: importAndApplyHomeBroker,
  })),
}));

jest.mock('../../../../src/core/invest/btgMonthImportService', () => ({
  applyBtgMonthImport,
  discoverMonthExtractPlan,
  monthBounds,
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
      calendar: ['2026-01'],
      activityLog: [{ message: 'sessao iniciada' }],
      schemaApplied: true,
    });
    reconcileCustody.mockResolvedValue({ ok: true });
    importAndApplyHomeBroker.mockResolvedValue({
      filesTotal: 1,
      snapshotsImported: 1,
      snapshotsApplied: 1,
      anchorsUpserted: 1,
      warnings: [],
      appliedDates: ['2026-01-02'],
    });
    discoverMonthExtractPlan.mockResolvedValue([
      {
        month: '2026-01',
        extractFile: { name: 'extratos/jan.txt', contentBase64: 'dHh0' },
      },
    ]);
    monthBounds.mockReturnValue({ from: '2026-01-01', to: '2026-01-31' });
    applyBtgMonthImport.mockResolvedValue({
      month: '2026-01',
      applied: true,
      notesOk: true,
      financialOk: true,
      resultOk: true,
      resultDetail: 'Importado.',
      notesInserted: 2,
      notesSkipped: 0,
      extractInserted: 5,
      extractSkipped: 0,
      extract: { importOk: true },
    });
    syncHistoricalFromBrapi.mockResolvedValue(4);
    syncMissingOptions.mockResolvedValue({ synced: 2, missing: 0 });
    rebuildPatrimony.mockImplementation(async (_ctx, opts) => {
      opts?.onProgress?.(1, 0, '2026-01-15');
      return { daysWritten: 1, daysSkipped: 0, threePricesUpdated: 1, warnings: [] };
    });
  });

  it('processa mes a mes com importacao mensal, cotacoes e rebuild com initialLoad', async () => {
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
    expect(discoverMonthExtractPlan).toHaveBeenCalledWith(extractFiles);
    expect(startSession).toHaveBeenCalledWith(ctx, expect.objectContaining({ phase: 'notes', files: notesFiles }));
    expect(importAndApplyHomeBroker).toHaveBeenCalledWith(ctx, homeBrokerFiles);
    expect(reconcileCustody).toHaveBeenCalledWith(ctx);
    expect(applyBtgMonthImport).toHaveBeenCalledWith(
      ctx,
      expect.any(Object),
      '2026-01',
      extractFiles[0],
      notesFiles,
      { previousClosingExtract: null, simulateFreshImport: false }
    );
    expect(syncHistoricalFromBrapi).toHaveBeenCalledWith(ctx);
    expect(syncMissingOptions).toHaveBeenCalledWith(ctx);
    expect(rebuildPatrimony).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        from: '2026-01-01',
        to: '2026-01-31',
        initialLoad: true,
      })
    );
    expect(finalState.activityLog.join('\n')).toContain('Rebuild final');
  });
});
