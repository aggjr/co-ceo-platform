import { InvestOperations } from '../../../../src/modules/invest/InvestOperations';
import { ThreePricesValuation } from '../../../../src/modules/invest/ThreePricesValuation';
import { BusinessEventRegistry } from '../../../../src/core/business-events';
import {
  InventoryLedger,
  InventoryRegistry,
  ValuationFactory,
} from '../../../../src/core/inventory';
import { WeightedAverageValuation } from '../../../../src/core/inventory/valuation/WeightedAverageValuation';
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
  for (const sub of ['stock', 'option_call', 'option_put', 'cash']) {
    await gw.insert(ctx, 'module_categories', {
      module_code: 'INVEST',
      category: 'financial_asset',
      subcategory: sub,
      default_valuation_method: 'three_prices_invest',
      default_quantity_unit: sub === 'cash' ? 'BRL' : 'shares',
      is_active: 1,
    });
  }
  await gw.insert(ctx, 'module_categories', {
    module_code: 'INVEST',
    category: 'financial_asset',
    subcategory: 'fixed_income',
    default_valuation_method: 'weighted_avg',
    default_quantity_unit: 'units',
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
  valuationFactory.register('weighted_avg', () => new WeightedAverageValuation());
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
    inventoryLedger,
    inventoryRegistry,
    businessEvents,
  };
}

function openingLftLine(): LedgerImportLine {
  return {
    date: '2026-01-09',
    ticker: 'LFT-20310301',
    operation: 'opening_balance',
    quantity: 1000,
    unit_price: 16,
    asset_type: 'fixed_income',
    total_net_value: 16000,
  };
}

function openingPrio3Line(): LedgerImportLine {
  return {
    date: '2026-01-02',
    ticker: 'PRIO3',
    operation: 'opening_balance',
    quantity: 1000,
    unit_price: 43,
    asset_type: 'stock',
    total_net_value: 43000,
  };
}

describe('InvestOperations — cost_adjustment (Caminho 1B)', () => {
  it('IRRF de TD: cria perna patrimony cost_adjustment + perna financial out no mesmo header', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    await ops.recordOperation(ctx, openingLftLine());

    const ref = 'BTG-TD-2026-01-10:LFT-20310301';
    const res = await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'LFT-20310301',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 24,
      asset_type: 'fixed_income',
      total_net_value: 24,
      event_source_ref: ref,
      notes: 'IRRF cobrado sobre op TD 09/01',
      broker_note_ref: 'BTG-EXT:2026-01-10:IRRF-TD',
    });

    expect(res.skipped).toBe(false);

    const patrimonyLegs = gw.dump('patrimony_ledger_entries').filter((r) => !r.deleted_at);
    const adj = patrimonyLegs.filter((l) => l.movement_type === 'cost_adjustment');
    expect(adj).toHaveLength(1);
    expect(Number(adj[0]!.unit_value)).toBeCloseTo(24, 4);
    expect(Number(adj[0]!.quantity_delta)).toBe(0);

    const financialLegs = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at);
    expect(financialLegs).toHaveLength(1);
    expect(financialLegs[0]?.direction).toBe('out');
    expect(Number(financialLegs[0]?.amount)).toBeCloseTo(24, 4);

    const headers = gw.dump('business_events');
    const tdHeader = headers.find((h) => h.source_ref === ref);
    expect(tdHeader).toBeDefined();
    expect(adj[0]!.business_event_id).toBe(tdHeader!.id);
    expect(financialLegs[0]!.business_event_id).toBe(tdHeader!.id);
  });

  it('PM Estrito e Gerencial absorvem o custo; B3 nao mexe (default applies_to_b3=false)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops, inventoryLedger, inventoryRegistry } = buildOps(gw);

    await ops.recordOperation(ctx, openingLftLine());
    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'LFT-20310301',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 24,
      asset_type: 'fixed_income',
      total_net_value: 24,
      event_source_ref: 'BTG-TD-2026-01-10:LFT-20310301',
    });

    const item = await inventoryRegistry.findByIdentifier(ctx, 'INVEST', 'LFT-20310301');
    expect(item).toBeDefined();
    const state = await inventoryLedger.rebuildPosition(ctx, item!.id);
    expect(state.quantity).toBe(1000);
    expect(state.acquisitionValue).toBeCloseTo(16024, 4);
    expect(state.pmA).toBeCloseTo(16.024, 6);
  });

  it('applies_to_b3=true sobe pmB tambem (caso defensivo)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops, inventoryLedger, inventoryRegistry } = buildOps(gw);

    await ops.recordOperation(ctx, openingPrio3Line());
    await ops.recordOperation(ctx, {
      date: '2026-01-15',
      ticker: 'PRIO3',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 100, // multa rateada absorvida pela posicao
      asset_type: 'stock',
      total_net_value: 100,
      applies_to_b3: true,
      event_source_ref: 'BTG-MULTA-2026-01-15:PRIO3',
    });

    const item = await inventoryRegistry.findByIdentifier(ctx, 'INVEST', 'PRIO3');
    const state = await inventoryLedger.rebuildPosition(ctx, item!.id);
    expect(state.pmA).toBeCloseTo(43.1, 4);
    expect(state.pmB).toBeCloseTo(43.1, 4);
    expect(state.pmC).toBeCloseTo(43.1, 4);
  });

  it('cost_adjustment com ticker CAIXA eh recusado (sanity)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    const res = await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'CAIXA-BTG',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 24,
      asset_type: 'cash',
      total_net_value: 24,
    });
    expect(res.skipped).toBe(true);
    expect(res.reason).toMatch(/cost_adjustment exige ticker patrimonial/);
  });

  it('amount zero => skipped (nao gera headers/pernas)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    await ops.recordOperation(ctx, openingLftLine());
    const before = gw.dump('business_events').length;

    const res = await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'LFT-20310301',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 0,
      asset_type: 'fixed_income',
      total_net_value: 0,
      event_source_ref: 'BTG-X',
    });
    expect(res.skipped).toBe(true);
    // ensureByRef cria header antes do skip => aceitavel, mas pernas n nao crescem
    const adj = gw
      .dump('patrimony_ledger_entries')
      .filter((r) => r.movement_type === 'cost_adjustment');
    expect(adj).toHaveLength(0);
    expect(gw.dump('business_events').length).toBeGreaterThanOrEqual(before);
  });

  it('duas pernas cost_adjustment com MESMO event_source_ref => 1 header', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildOps(gw);

    await ops.recordOperation(ctx, openingLftLine());

    const ref = 'BTG-TD-2026-01-10:LFT-20310301';
    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'LFT-20310301',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 20,
      asset_type: 'fixed_income',
      total_net_value: 20,
      event_source_ref: ref,
      broker_note_ref: 'IRRF-1',
      notes: 'IRRF',
    });
    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'LFT-20310301',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 4,
      asset_type: 'fixed_income',
      total_net_value: 4,
      event_source_ref: ref,
      broker_note_ref: 'TAXA-1',
      notes: 'Taxa custodia TD',
    });

    const headers = gw
      .dump('business_events')
      .filter((h) => h.source_ref === ref);
    expect(headers).toHaveLength(1);

    const adj = gw
      .dump('patrimony_ledger_entries')
      .filter((r) => r.movement_type === 'cost_adjustment' && !r.deleted_at);
    expect(adj).toHaveLength(2);
    expect(new Set(adj.map((a) => a.business_event_id))).toEqual(
      new Set([headers[0]!.id])
    );
  });
});
