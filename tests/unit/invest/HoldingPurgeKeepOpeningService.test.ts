import { HoldingPurgeKeepOpeningService } from '../../../src/core/invest/HoldingPurgeKeepOpeningService';
import type { CoCeoDataGateway } from '../../../src/core/dal';
import type { UserContext } from '../../../src/core/dal';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

const listLedgerEvents = jest.fn();

jest.mock('../../../src/core/invest/LedgerImportService', () => ({
  LedgerImportService: jest.fn().mockImplementation(() => ({
    listLedgerEvents,
    reconcileCustody: jest.fn().mockResolvedValue({ ok: true }),
  })),
}));

function mockPoolForPreview(
  openingLegsToRemove: number,
  auxRowCount = 5,
  businessEventsToRemove = 1
) {
  const conn = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM business_events') && sql.includes('source_ref')) {
        return [[{ id: 'ev-opening' }]];
      }
      if (sql.includes('opening_balance') && sql.includes('DISTINCT')) {
        return [[{ id: 'ev-opening' }]];
      }
      if (sql.includes('NOT') && sql.includes('patrimony_ledger')) {
        return [[{ n: openingLegsToRemove }]];
      }
      if (sql.includes('NOT') && sql.includes('financial_ledger')) {
        return [[{ n: 0 }]];
      }
      if (sql.includes('patrimony_ledger') && sql.includes('COUNT')) {
        return [[{ n: 3 }]];
      }
      if (sql.includes('business_events be') && sql.includes('source_ref <>')) {
        return [[{ n: businessEventsToRemove }]];
      }
      if (sql.startsWith('SELECT COUNT(*)') && sql.includes('FROM `')) {
        return [[{ n: auxRowCount }]];
      }
      return [[{ n: 0 }]];
    }),
    release: jest.fn(),
  };
  return {
    getConnection: jest.fn().mockResolvedValue(conn),
  };
}

function mockGateway(): CoCeoDataGateway {
  return {
    findWhere: jest.fn(),
    insert: jest.fn(),
    readQuery: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    deleteMatching: jest.fn(),
    transaction: jest.fn(),
    softDelete: jest.fn(),
    getOrganizationStorage: jest.fn(),
    recordTelemetryEvents: jest.fn(),
  } as unknown as CoCeoDataGateway;
}

describe('HoldingPurgeKeepOpeningService', () => {
  beforeEach(() => {
    listLedgerEvents.mockResolvedValue([
      {
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      },
    ]);
  });

  it('preflight pede escolha quando há dados além da abertura', async () => {
    const service = new HoldingPurgeKeepOpeningService(
      mockGateway(),
      mockPoolForPreview(10) as never
    );
    const pf = await service.preflight(ctx);
    expect(pf.needsDataModeChoice).toBe(true);
    expect(pf.openingDate).toBe('2026-01-01');
    expect(pf.openingRef).toBe('OPENING:2026-01-01');
    expect(pf.purgePreview?.patrimonyLegsToRemove).toBe(10);
  });

  it('preflight não pede escolha quando só abertura', async () => {
    const service = new HoldingPurgeKeepOpeningService(
      mockGateway(),
      mockPoolForPreview(0, 0, 0) as never
    );
    const pf = await service.preflight(ctx);
    expect(pf.needsDataModeChoice).toBe(false);
  });
});
