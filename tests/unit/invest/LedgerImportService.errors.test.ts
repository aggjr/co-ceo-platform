import { LedgerImportService } from '../../../src/core/invest/LedgerImportService';
import { GatewayError } from '../../../src/core/dal/errors';
import type { CoCeoDataGateway } from '../../../src/core/dal';
import type { UserContext } from '../../../src/core/dal';

function mockGateway(): CoCeoDataGateway {
  return {
    findWhere: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockResolvedValue({ insertId: 1, recordId: 'x', affectedRows: 1 }),
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

const ctxWithOrg: UserContext = {
  userId: 'u1',
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

const ctxWithoutOrg: UserContext = {
  userId: 'u1',
  organizationId: null,
  impersonatorId: null,
  scope: 'node',
};

describe('LedgerImportService — erros de validação', () => {
  it('importPortfolio lança INVALID_CONTEXT sem organizationId', async () => {
    const service = new LedgerImportService(mockGateway());
    await expect(
      service.importPortfolio(ctxWithoutOrg, {
        opening_date: '2026-01-01',
        opening_positions: [],
        entries: [],
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CONTEXT',
      httpStatus: 400,
    });
  });

  it('importPortfolio lança INVALID_PAYLOAD para opening_date inválida', async () => {
    const service = new LedgerImportService(mockGateway());
    await expect(
      service.importPortfolio(ctxWithOrg, {
        opening_date: 'data-invalida',
        opening_positions: [],
        entries: [],
      })
    ).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      httpStatus: 400,
    });
  });

  it('listLedgerEvents lança INVALID_CONTEXT sem organizationId', async () => {
    const service = new LedgerImportService(mockGateway());
    await expect(service.listLedgerEvents(ctxWithoutOrg, '2026-01-01', '2026-01-31')).rejects.toThrow(
      GatewayError
    );
    await expect(service.listLedgerEvents(ctxWithoutOrg, '2026-01-01', '2026-01-31')).rejects.toMatchObject({
      code: 'INVALID_CONTEXT',
    });
  });

  it('reconcileCustody exige organização no contexto', async () => {
    const service = new LedgerImportService(mockGateway());
    await expect(service.reconcileCustody(ctxWithoutOrg)).rejects.toMatchObject({
      code: 'INVALID_CONTEXT',
    });
  });
});
