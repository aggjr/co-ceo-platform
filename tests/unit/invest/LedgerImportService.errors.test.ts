import { LedgerImportService } from '../../../src/core/invest/LedgerImportService';
import { GatewayError } from '../../../src/core/dal/errors';
import type { CoCeoDataGateway } from '../../../src/core/dal';
import type { UserContext } from '../../../src/core/dal';
import { castGateway, InMemoryGateway } from '../core/business-events/inMemoryGateway';

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

  it('importEntriesOnly preserves explicit settlement_date from import lines', async () => {
    const gw = new InMemoryGateway();
    await gw.insert(ctxWithOrg, 'contracts', {
      id: 'contract-invest',
      organization_id: ctxWithOrg.organizationId,
      status: 'active',
    });
    await gw.insert(ctxWithOrg, 'contract_modules', {
      contract_id: 'contract-invest',
      module_code: 'INVEST',
      status: 'active',
    });
    await gw.insert(ctxWithOrg, 'module_categories', {
      module_code: 'INVEST',
      category: 'financial_asset',
      subcategory: 'stock',
      default_name: 'Acao',
      default_valuation_method: 'three_prices_invest',
      default_quantity_unit: 'shares',
      is_active: 1,
    });
    await gw.insert(ctxWithOrg, 'module_categories', {
      module_code: 'INVEST',
      category: 'financial_asset',
      subcategory: 'cash',
      default_name: 'Caixa',
      default_valuation_method: 'cash_balance',
      default_quantity_unit: 'BRL',
      is_active: 1,
    });
    await gw.insert(ctxWithOrg, 'module_valuation_methods', {
      method_code: 'three_prices_invest',
      is_active: 1,
    });
    await gw.insert(ctxWithOrg, 'module_valuation_methods', {
      method_code: 'cash_balance',
      is_active: 1,
    });
    const { seedPolicies } = require('../modules/invest/seedPolicies');
    await seedPolicies(gw, ctxWithOrg);

    const service = new LedgerImportService(castGateway(gw));
    (service as any).patrimonyStore.invalidateFromDate = jest.fn().mockResolvedValue(undefined);

    const result = await service.importEntriesOnly(ctxWithOrg, [
      {
        date: '2026-05-12',
        ticker: 'PRIO3',
        asset_type: 'stock',
        operation: 'buy',
        quantity: 10,
        unit_price: 40,
        total_net_value: -400,
        settlement_date: '2026-05-12',
        broker_note_ref: 'TEST-SETTLEMENT-PRIO3',
      },
    ]);

    expect(result.inserted).toBe(1);
    const financialLegs = gw.dump('financial_ledger_entries');
    expect(financialLegs).toHaveLength(1);
    expect(financialLegs[0]!.transaction_date).toBe('2026-05-12');
    expect(financialLegs[0]!.settlement_date).toBe('2026-05-12');
  });
});

