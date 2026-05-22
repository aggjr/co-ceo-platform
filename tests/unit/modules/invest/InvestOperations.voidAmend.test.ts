import { randomUUID } from 'crypto';
import { InvestOperations } from '../../../../src/modules/invest/InvestOperations';
import { ThreePricesValuation } from '../../../../src/modules/invest/ThreePricesValuation';
import {
  BusinessEventRegistry,
} from '../../../../src/core/business-events';
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
  await gw.insert(ctx, 'module_valuation_methods', {
    method_code: 'three_prices_invest',
    is_active: 1,
  });
  await gw.insert(ctx, 'module_settlement_profiles', {
    profile_code: 'INSTANT',
    settlement_days: 0,
    is_active: 1,
  });
}

function buildStack(gw: InMemoryGateway) {
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
  const ops = new InvestOperations(
    gateway,
    inventoryRegistry,
    inventoryLedger,
    accountRegistry,
    financialLedger,
    businessEvents
  );
  return { ops, businessEvents, inventoryRegistry, inventoryLedger };
}

async function seedHeaderAndPatrimonyLeg(
  gw: InMemoryGateway,
  businessEvents: BusinessEventRegistry,
  options: { ticker: string; quantity: number; unitPrice: number; sourceRef: string }
) {
  const event = await businessEvents.create(ctx, {
    sourceModule: 'INVEST',
    eventKind: 'broker_note_spot',
    occurredOn: '2026-04-17',
    settlesOn: '2026-04-22',
    sourceRef: options.sourceRef,
    sourceSystem: 'test',
    totalNet: options.quantity * options.unitPrice * -1,
  });

  const itemId = randomUUID();
  await gw.insert(ctx, 'patrimony_items', {
    id: itemId,
    source_module: 'INVEST',
    category: 'financial_asset',
    subcategory: 'stock',
    identifier: options.ticker,
    name: options.ticker,
    quantity: options.quantity,
    quantity_unit: 'shares',
    acquisition_value: options.quantity * options.unitPrice,
    current_value: options.quantity * options.unitPrice,
    currency: 'BRL',
    status: 'active',
  });

  const legId = randomUUID();
  await gw.insert(ctx, 'patrimony_ledger_entries', {
    id: legId,
    patrimony_item_id: itemId,
    business_event_id: event.id,
    transaction_date: '2026-04-17',
    movement_type: 'acquisition',
    quantity_delta: options.quantity,
    unit_value: options.unitPrice,
    total_value: options.quantity * options.unitPrice,
    impacts_valuation: 1,
  });

  return { event, itemId, legId };
}

describe('InvestOperations.voidEvent', () => {
  it('marca header voided, soft-deleta perna e rebuilda quantity=0', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);

    const { event, itemId, legId } = await seedHeaderAndPatrimonyLeg(
      gw,
      stack.businessEvents,
      { ticker: 'PRIO3', quantity: 100, unitPrice: 39.5, sourceRef: 'NOTA-1' }
    );

    const result = await stack.ops.voidEvent(ctx, event.id, 'cancelado pela B3');

    expect(result.voidedPatrimonyLegs).toBe(1);
    expect(result.voidedFinancialLegs).toBe(0);
    expect(result.rebuiltItems).toBe(1);

    const reloaded = await stack.businessEvents.findById(ctx, event.id);
    expect(reloaded?.voided_at).toBeTruthy();
    expect(reloaded?.void_reason).toBe('cancelado pela B3');

    const leg = await stack.inventoryLedger['gateway'];
    // perna soft-deletada
    const legRow = gw.dump('patrimony_ledger_entries').find((r) => r.id === legId);
    expect(legRow?.deleted_at).toBeTruthy();
    void leg;

    // quantity foi rebuildada para 0
    const item = await stack.inventoryRegistry.findById(ctx, itemId);
    expect(Number(item?.quantity)).toBe(0);
    expect(Number(item?.acquisition_value)).toBe(0);
  });

  it('lanca 409 se header ja esta voided', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);

    const { event } = await seedHeaderAndPatrimonyLeg(gw, stack.businessEvents, {
      ticker: 'VALE3',
      quantity: 10,
      unitPrice: 60,
      sourceRef: 'NOTA-2',
    });

    await stack.ops.voidEvent(ctx, event.id, 'primeira anulacao');
    await expect(stack.ops.voidEvent(ctx, event.id, 'segunda')).rejects.toMatchObject({
      code: 'FINANCIAL_RULE_VIOLATION',
      httpStatus: 409,
    });
  });

  it('lanca 404 se header nao existe', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);
    await expect(stack.ops.voidEvent(ctx, randomUUID(), 'x')).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
  });
});

describe('InvestOperations.amendEvent', () => {
  it('cria revisao 2 supersedendo a 1, soft-deleta pernas antigas e rebuilda', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);

    const { event, itemId, legId } = await seedHeaderAndPatrimonyLeg(
      gw,
      stack.businessEvents,
      { ticker: 'ITUB4', quantity: 200, unitPrice: 35, sourceRef: 'NOTA-AMD' }
    );

    const result = await stack.ops.amendEvent(
      ctx,
      event.id,
      { totalNet: -7000 }, // header patch
      [] // sem novas linhas: amend "esvazia" o evento
    );

    expect(result.revisionNo).toBe(2);
    expect(result.voidedPatrimonyLegs).toBe(1);
    expect(result.recreatedLines).toBe(0);
    expect(result.rebuiltItems).toBe(1);

    const newHead = await stack.businessEvents.findById(ctx, result.newEventId);
    expect(newHead?.revision_no).toBe(2);
    expect(newHead?.supersedes_event_id).toBe(event.id);
    expect(newHead?.total_net).toBe(-7000);

    // perna v1 soft-deletada
    const legRow = gw.dump('patrimony_ledger_entries').find((r) => r.id === legId);
    expect(legRow?.deleted_at).toBeTruthy();

    // rebuild zerou a quantity (sem pernas vivas)
    const item = await stack.inventoryRegistry.findById(ctx, itemId);
    expect(Number(item?.quantity)).toBe(0);
  });

  it('preserva sourceRef da revisao 1 e mantem a cadeia coerente', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);
    const { event } = await seedHeaderAndPatrimonyLeg(gw, stack.businessEvents, {
      ticker: 'PETR4',
      quantity: 50,
      unitPrice: 38,
      sourceRef: 'NOTA-CHAIN',
    });

    const r2 = await stack.ops.amendEvent(ctx, event.id, {}, []);
    const chain = await stack.businessEvents.listRevisions(ctx, 'INVEST', 'NOTA-CHAIN');
    expect(chain.map((c) => c.revision_no)).toEqual([1, 2]);
    expect(chain[1]?.id).toBe(r2.newEventId);
    expect(chain[1]?.source_ref).toBe('NOTA-CHAIN');
  });

  it('lanca 409 se header ja esta voided', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);
    const { event } = await seedHeaderAndPatrimonyLeg(gw, stack.businessEvents, {
      ticker: 'BBAS3',
      quantity: 10,
      unitPrice: 25,
      sourceRef: 'NOTA-V',
    });
    await stack.ops.voidEvent(ctx, event.id, 'anulei');
    await expect(stack.ops.amendEvent(ctx, event.id, {}, [])).rejects.toMatchObject({
      code: 'FINANCIAL_RULE_VIOLATION',
      httpStatus: 409,
    });
  });

  it('lanca 404 se header nao existe', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const stack = buildStack(gw);
    await expect(
      stack.ops.amendEvent(ctx, randomUUID(), {}, [])
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
});
