import type { CoCeoDataGateway } from '../../../src/core/dal';
import type { UserContext } from '../../../src/core/dal';

const listLedgerEvents = jest.fn();
const reconcileCustody = jest.fn();

jest.mock('../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    listLedgerEvents,
    reconcileCustody,
  })),
}));

import { PatrimonyDailyRebuildService } from '../../../src/core/invest/PatrimonyDailyRebuildService';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

jest.mock('../../../src/core/invest/PatrimonyDailyStore', () => ({
  PatrimonyDailyStore: jest.fn().mockImplementation(() => ({
    invalidateFromDate: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../src/core/invest/PatrimonyDailyRecorder', () => ({
  PatrimonyDailyRecorder: jest.fn().mockImplementation(() => ({
    recordDay: jest.fn().mockResolvedValue({
      snapshotDate: '2026-01-02',
      recorded: { source: 'mtm_economic', patrimony: 100 },
      positionsSaved: 1,
      quotesAsOf: '2026-01-02',
      economicPatrimony: 100,
      btgPatrimony: null,
    }),
  })),
}));

jest.mock('../../../src/modules/invest/sync/InvestAssetProjection', () => ({
  InvestAssetProjection: jest.fn().mockImplementation(() => ({
    listActiveAssets: jest.fn().mockResolvedValue([
      { asset_ticker: 'PRIO3', asset_type: 'stock' },
    ]),
  })),
}));

jest.mock('../../../src/core/market/MarketQuoteRepository', () => ({
  MarketQuoteRepository: jest.fn().mockImplementation(() => ({
    loadQuoteMapForRange: jest.fn().mockResolvedValue(
      new Map([['PRIO3', new Map([['2026-01-02', { price: 40, date: '2026-01-02' }]])]])
    ),
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

describe('PatrimonyDailyRebuildService', () => {
  beforeEach(() => {
    listLedgerEvents.mockReset();
    reconcileCustody.mockReset();
  });

  it('rebuild invalida, grava dias úteis com economicOnly e reconcilia custódia', async () => {
    const gateway = mockGateway();
    listLedgerEvents.mockResolvedValue([
      {
        asset_id: 's1',
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
    reconcileCustody.mockResolvedValue({ ok: true });

    const service = new PatrimonyDailyRebuildService(gateway);
    const result = await service.rebuild(ctx, {
      from: '2026-01-01',
      to: '2026-01-05',
    });

    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-01-05');
    expect(result.daysWritten).toBeGreaterThan(0);
    expect(reconcileCustody).toHaveBeenCalled();

    const { PatrimonyDailyStore } = jest.requireMock('../../../src/core/invest/PatrimonyDailyStore');
    const store = PatrimonyDailyStore.mock.results[0].value;
    expect(store.invalidateFromDate).toHaveBeenCalledWith(ctx, '2026-01-01');

    const { PatrimonyDailyRecorder } = jest.requireMock(
      '../../../src/core/invest/PatrimonyDailyRecorder'
    );
    const recorder = PatrimonyDailyRecorder.mock.results[0].value;
    expect(recorder.recordDay).toHaveBeenCalled();
    const firstCall = recorder.recordDay.mock.calls[0];
    expect(firstCall[2]).toEqual({ economicOnly: true });
  });

  it('exige organizationId', async () => {
    const service = new PatrimonyDailyRebuildService(mockGateway());
    await expect(
      service.rebuild({ ...ctx, organizationId: null })
    ).rejects.toThrow(/organizationId/);
  });
});
