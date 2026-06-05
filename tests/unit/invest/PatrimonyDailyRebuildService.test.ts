import type { CoCeoDataGateway } from '../../../src/core/dal';
import type { UserContext } from '../../../src/core/dal';

const invalidateFromDate = jest.fn();
const recordDay = jest.fn();
const listLedgerEvents = jest.fn();
const reconcileCustody = jest.fn();
const loadQuoteMapForRange = jest.fn();
const getLastQuoteDate = jest.fn();
const listActiveAssets = jest.fn();
const recalcThreePricesPublic = jest.fn();

jest.mock('../../../src/core/invest/reconcile/DailyCloseMaterializeService', () => ({
  DailyCloseMaterializeService: jest.fn().mockImplementation(() => ({
    recalcThreePricesPublic,
  })),
}));

jest.mock('../../../src/core/invest/PatrimonyDailyStore', () => ({
  PatrimonyDailyStore: jest.fn().mockImplementation(() => ({
    invalidateFromDate,
  })),
}));

jest.mock('../../../src/core/invest/PatrimonyDailyRecorder', () => ({
  PatrimonyDailyRecorder: jest.fn().mockImplementation(() => ({
    recordDay,
  })),
}));

jest.mock('../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    listLedgerEvents,
    reconcileCustody,
  })),
}));

jest.mock('../../../src/core/market/MarketQuoteRepository', () => ({
  MarketQuoteRepository: jest.fn().mockImplementation(() => ({
    loadQuoteMapForRange,
    getLastQuoteDate,
  })),
}));

jest.mock('../../../src/modules/invest/sync/InvestAssetProjection', () => ({
  InvestAssetProjection: jest.fn().mockImplementation(() => ({
    listActiveAssets,
  })),
}));

import { PatrimonyDailyRebuildService } from '../../../src/core/invest/PatrimonyDailyRebuildService';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-1',
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

describe('PatrimonyDailyRebuildService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listLedgerEvents.mockResolvedValue([
      {
        transaction_date: '2026-01-02',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        quantity: 100,
        unit_price: 10,
        total_net_value: 0,
      },
    ]);
    recordDay.mockResolvedValue({ economicPatrimony: 1000 });
    reconcileCustody.mockResolvedValue({ ok: true });
    loadQuoteMapForRange.mockResolvedValue(new Map());
    getLastQuoteDate.mockResolvedValue(null);
    listActiveAssets.mockResolvedValue([]);
    invalidateFromDate.mockResolvedValue(undefined);
    recalcThreePricesPublic.mockResolvedValue({ positionsUpdated: 1, positionsZeroed: 0 });
  });

  it('invalida, grava dias úteis com calibração BTG quando houver âncoras e reconcilia custódia', async () => {
    const svc = new PatrimonyDailyRebuildService(mockGateway());
    const result = await svc.rebuild(ctx, { from: '2026-01-01', to: '2026-01-05' });

    expect(invalidateFromDate).toHaveBeenCalledWith(ctx, '2026-01-02');
    expect(recordDay).toHaveBeenCalled();
    for (const call of recordDay.mock.calls) {
      expect(call[2]).toBeUndefined();
    }
    expect(result.daysWritten).toBeGreaterThan(0);
    expect(reconcileCustody).toHaveBeenCalledWith(ctx);
    expect(recalcThreePricesPublic).toHaveBeenCalledWith(ctx, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(result.threePricesUpdated).toBe(1);
  });

  it('limita rebuild pela ultima cotacao confiavel', async () => {
    getLastQuoteDate.mockResolvedValue('2026-01-05');
    const svc = new PatrimonyDailyRebuildService(mockGateway());

    const result = await svc.rebuild(ctx, { from: '2026-01-02', to: '2026-01-10' });

    expect(result.to).toBe('2026-01-05');
    expect(loadQuoteMapForRange).toHaveBeenCalledWith(ctx, '2026-01-02', '2026-01-05');
    expect(recalcThreePricesPublic).toHaveBeenCalledWith(ctx, '2026-01-05');
    expect(result.warnings.some((w) => w.includes('Rebuild limitado ate 2026-01-05'))).toBe(true);
  });

  it('lastTrustedDate explicito prevalece sobre ultima cotacao automatica', async () => {
    getLastQuoteDate.mockResolvedValue('2026-01-05');
    const svc = new PatrimonyDailyRebuildService(mockGateway());

    const result = await svc.rebuild(ctx, {
      from: '2026-01-02',
      to: '2026-01-10',
      lastTrustedDate: '2026-01-06',
    });

    expect(result.to).toBe('2026-01-06');
    expect(loadQuoteMapForRange).toHaveBeenCalledWith(ctx, '2026-01-02', '2026-01-06');
    expect(recalcThreePricesPublic).toHaveBeenCalledWith(ctx, '2026-01-06');
  });
});
