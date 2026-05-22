import { InvestOperations } from '../../../../src/modules/invest/InvestOperations';
import { ThreePricesValuation } from '../../../../src/modules/invest/ThreePricesValuation';
import { BusinessEventRegistry } from '../../../../src/core/business-events';
import {
  InventoryLedger,
  InventoryRegistry,
  ValuationFactory,
} from '../../../../src/core/inventory';
import {
  FinancialAccountRegistry,
  FinancialLedger,
  SettlementEngine,
} from '../../../../src/core/financial';
import { ContractGuard, ModuleCategories } from '../../../../src/core/module-registry';
import {
  SYSTEM_INSTALLER_USER_ID,
  type UserContext,
} from '../../../../src/core/dal/types';
import type { LedgerImportLine } from '../../../../src/core/invest/ledgerTypes';
import { InMemoryGateway, castGateway } from '../../core/business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: 'org-holding-001',
  impersonatorId: null,
  scope: 'node',
};

async function seedCatalog(gw: InMemoryGateway): Promise<void> {
  await gw.insert(ctx, 'module_categories', {
    module_code: 'INVEST',
    category: 'financial_asset',
    subcategory: 'stock',
    default_valuation_method: 'three_prices_invest',
    default_quantity_unit: 'shares',
    is_active: 1,
  });
  await gw.insert(ctx, 'module_categories', {
    module_code: 'INVEST',
    category: 'financial_asset',
    subcategory: 'cash',
    default_valuation_method: 'weighted_avg',
    default_quantity_unit: 'BRL',
    is_active: 1,
  });
  await gw.insert(ctx, 'module_valuation_methods', {
    method_code: 'three_prices_invest',
    is_active: 1,
  });
  await gw.insert(ctx, 'module_valuation_methods', {
    method_code: 'weighted_avg',
    is_active: 1,
  });
  await gw.insert(ctx, 'module_settlement_profiles', {
    profile_code: 'INSTANT',
    settlement_days: 0,
    is_active: 1,
  });
}

function buildOps(gw: InMemoryGateway) {
  const gateway = castGateway(gw);
  const categories = new ModuleCategories(gateway);
  const contractGuard = new ContractGuard(gateway, categories);
  const valuationFactory = new ValuationFactory(categories);
  valuationFactory.register('three_prices_invest', () => new ThreePricesValuation());
  const inventoryRegistry = new InventoryRegistry(gateway, categories, contractGuard);
  const inventoryLedger = new InventoryLedger(gateway, inventoryRegistry, valuationFactory);
  const settlementEngine = new SettlementEngine(gateway, categories);
  const accountRegistry = new FinancialAccountRegistry(gateway, contractGuard);
  const financialLedger = new FinancialLedger(gateway, settlementEngine);
  const businessEvents = new BusinessEventRegistry(gateway);
  return {
    ops: new InvestOperations(
      gateway,
      inventoryRegistry,
      inventoryLedger,
      accountRegistry,
      financialLedger,
      businessEvents
    ),
    businessEvents,
  };
}

function cashYieldLine(overrides: Partial<LedgerImportLine>): LedgerImportLine {
  return {
    date: '2026-04-17',
    ticker: 'CAIXA-BTG',
    operation: 'cash_yield',
    quantity: 0,
    unit_price: 0,
    total_net_value: 100,
    asset_type: 'cash',
    ...overrides,
  };
}

describe('InvestOperations — agrupamento de pernas por event_source_ref (Saida B)', () => {
  it('2 linhas com MESMO event_source_ref e broker_note_ref distintos => 1 header, 2 pernas', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    const ref = 'BTG-NOTA-12345';
    await ops.recordOperation(ctx, cashYieldLine({
      event_source_ref: ref,
      broker_note_ref: 'BTG-NOTA-12345#2026-04-17#1',
      total_net_value: 500,
    }));
    await ops.recordOperation(ctx, cashYieldLine({
      event_source_ref: ref,
      broker_note_ref: 'BTG-NOTA-12345#2026-04-17#2',
      total_net_value: 300,
    }));

    const headers = gw.dump('business_events');
    expect(headers).toHaveLength(1);
    expect(headers[0]?.source_ref).toBe(ref);

    const legs = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at);
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((l) => l.business_event_id))).toEqual(new Set([headers[0]!.id]));
    // broker_note_ref vira external_ref na perna — idempotencia individual
    const externalRefs = legs.map((l) => l.external_ref).sort();
    expect(externalRefs).toEqual([
      'BROKER_REF:BTG-NOTA-12345#2026-04-17#1',
      'BROKER_REF:BTG-NOTA-12345#2026-04-17#2',
    ]);
  });

  it('2 linhas SEM event_source_ref => 2 headers (1 por linha)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    await ops.recordOperation(ctx, cashYieldLine({
      broker_note_ref: 'BTG-EXT-2026-04-17#01',
      total_net_value: 50,
    }));
    await ops.recordOperation(ctx, cashYieldLine({
      broker_note_ref: 'BTG-EXT-2026-04-17#02',
      total_net_value: 80,
    }));

    expect(gw.dump('business_events')).toHaveLength(2);
    const legs = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at);
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((l) => l.business_event_id)).size).toBe(2);
  });

  it('reimport com mesmo event_source_ref + mesmo broker_note_ref => skip (idempotencia da perna)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    const line = cashYieldLine({
      event_source_ref: 'BTG-NOTA-99',
      broker_note_ref: 'BTG-NOTA-99#2026-04-17#1',
      total_net_value: 500,
    });
    const r1 = await ops.recordOperation(ctx, line);
    expect(r1.skipped).toBe(false);
    const r2 = await ops.recordOperation(ctx, line);
    expect(r2.skipped).toBe(true);

    expect(gw.dump('business_events')).toHaveLength(1);
    const legs = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at);
    expect(legs).toHaveLength(1);
  });

  it('linhas com event_source_ref distintos => headers distintos mesmo no mesmo dia/ticker', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    await ops.recordOperation(ctx, cashYieldLine({
      event_source_ref: 'BTG-NOTA-A',
      broker_note_ref: 'BTG-NOTA-A#1',
    }));
    await ops.recordOperation(ctx, cashYieldLine({
      event_source_ref: 'BTG-NOTA-B',
      broker_note_ref: 'BTG-NOTA-B#1',
    }));

    const headers = gw.dump('business_events');
    expect(headers.map((h) => h.source_ref).sort()).toEqual(['BTG-NOTA-A', 'BTG-NOTA-B']);
  });
});
