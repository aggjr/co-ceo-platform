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
  organizationId: 'org-coupling-001',
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
    subcategory: 'fixed_income',
    default_valuation_method: 'three_prices_invest',
    default_quantity_unit: 'un',
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
  return { gw, ops, businessEvents, inventoryRegistry, inventoryLedger, financialLedger };
}

// ===========================================================================
// TRADE: link bidirecional obrigatório — AMBAS as pernas existem
// ===========================================================================
describe('Trade: link bidirecional entre pernas (ambas existem)', () => {
  it('buy cria patrimony leg + financial leg com related_*_id preenchidos', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-04-17',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 52.0,
      total_net_value: -5200,
      broker_note_ref: 'BUY-LINK-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter((r) => !r.deleted_at);
    const finRows = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at);

    expect(patRows.length).toBeGreaterThanOrEqual(1);
    expect(finRows.length).toBeGreaterThanOrEqual(1);

    const patLeg = patRows.find((r) => r.movement_type === 'acquisition');
    const finLeg = finRows.find((r) => String(r.external_ref ?? '').includes('BUY-LINK-1'));

    expect(patLeg).toBeTruthy();
    expect(finLeg).toBeTruthy();
    expect(patLeg!.related_financial_entry_id).toBe(finLeg!.id);
    expect(finLeg!.related_patrimony_ledger_id).toBe(patLeg!.id);
  });

  it('cost_adjustment cria ambas as pernas linkadas', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-03-01',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 50,
      broker_note_ref: 'CA-SETUP',
    });

    await ops.recordOperation(ctx, {
      date: '2026-03-05',
      ticker: 'VALE3',
      operation: 'cost_adjustment',
      quantity: 0,
      unit_price: 15.0,
      broker_note_ref: 'CA-LINK-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter(
      (r) => !r.deleted_at && r.movement_type === 'cost_adjustment'
    );
    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('CA-LINK-1')
    );

    expect(patRows.length).toBe(1);
    expect(finRows.length).toBe(1);
    expect(patRows[0].related_financial_entry_id).toBe(finRows[0].id);
    expect(finRows[0].related_patrimony_ledger_id).toBe(patRows[0].id);
  });
});

// ===========================================================================
// PROVENTOS: financial-only — legítimo, ativo gerador pode não ser identificável
// ===========================================================================
describe('Proventos (dividend/jcp): financial-only por design', () => {
  it('dividend com ticker de ativo: apenas financial leg (sem patrimony leg forçada)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    // Cria o ativo (pode ou não existir — dividendo pode chegar antes)
    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 50,
      broker_note_ref: 'DIV-SETUP',
    });

    await ops.recordOperation(ctx, {
      date: '2026-04-20',
      ticker: 'VALE3',
      operation: 'dividend',
      quantity: 100,
      unit_price: 2.5,
      total_net_value: 250,
      broker_note_ref: 'DIV-1',
    });

    // Apenas a perna da compra (acquisition) deve existir no patrimônio
    const incomeInKindRows = gw.dump('patrimony_ledger_entries').filter(
      (r) => !r.deleted_at && r.movement_type === 'income_in_kind'
    );
    expect(incomeInKindRows.length).toBe(0); // sem patrimony leg forçada

    // Perna financeira existe e traz o ticker candidato no metadata
    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('DIV-1')
    );
    expect(finRows.length).toBe(1);
    expect(finRows[0].direction).toBe('in');
    expect(Number(finRows[0].amount)).toBe(250);

    // metadata guarda o ticker candidato para rastreabilidade futura
    const meta = typeof finRows[0].metadata === 'string'
      ? JSON.parse(finRows[0].metadata)
      : finRows[0].metadata;
    expect(meta.target_ticker).toBe('VALE3');
    // Sem link patrimonial — correto
    expect(finRows[0].related_patrimony_ledger_id).toBeFalsy();
  });

  it('dividend com ticker CAIXA-BTG (overnight/rendimento de conta): apenas financial leg, sem target_ticker', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-04-20',
      ticker: 'CAIXA-BTG',
      operation: 'dividend',
      quantity: 1,
      unit_price: 100,
      total_net_value: 100,
      broker_note_ref: 'OVER-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter((r) => !r.deleted_at);
    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('OVER-1')
    );

    expect(patRows.length).toBe(0); // sem ativo
    expect(finRows.length).toBe(1);

    // Sem target_ticker quando ticker já é de caixa
    const meta = typeof finRows[0].metadata === 'string'
      ? JSON.parse(finRows[0].metadata)
      : finRows[0].metadata;
    expect(meta.target_ticker).toBeFalsy();
  });

  it('capital_deposit: apenas financial leg (capital não é ativo patrimonial)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-04-20',
      ticker: 'CAIXA-BTG',
      operation: 'capital_deposit',
      quantity: 1,
      unit_price: 10000,
      total_net_value: 10000,
      broker_note_ref: 'DEPOSIT-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter((r) => !r.deleted_at);
    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('DEPOSIT-1')
    );

    expect(patRows.length).toBe(0);
    expect(finRows.length).toBe(1);
    expect(finRows[0].direction).toBe('in');
  });
});

// ===========================================================================
// DESPESAS com ativo identificável: patrimony leg é legítima
// ===========================================================================
describe('Despesas (fee/penalty): patrimony leg quando ativo é identificável', () => {
  it('fee com ticker de ativo: cria cost_adjustment patrimonial + financial leg linkados', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 50,
      broker_note_ref: 'FEE-SETUP',
    });

    await ops.recordOperation(ctx, {
      date: '2026-04-25',
      ticker: 'VALE3',
      operation: 'fee',
      quantity: 1,
      unit_price: 12.5,
      total_net_value: 12.5,
      broker_note_ref: 'FEE-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter(
      (r) => !r.deleted_at && r.movement_type === 'cost_adjustment' &&
        String(r.external_ref ?? '').includes('FEE-1')
    );
    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('FEE-1')
    );

    expect(patRows.length).toBe(1);
    expect(finRows.length).toBe(1);
    // Link bidirecional — fee TEM ativo causador identificado
    expect(patRows[0].related_financial_entry_id).toBe(finRows[0].id);
    expect(finRows[0].related_patrimony_ledger_id).toBe(patRows[0].id);
  });

  it('fee com ticker de caixa (multa sem ativo específico): apenas financial leg', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-04-25',
      ticker: 'CAIXA-BTG',
      operation: 'fee',
      quantity: 1,
      unit_price: 50.0,
      total_net_value: 50.0,
      broker_note_ref: 'PENALTY-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter((r) => !r.deleted_at);
    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('PENALTY-1')
    );

    expect(patRows.length).toBe(0); // sem ativo → sem patrimony leg
    expect(finRows.length).toBe(1);
    expect(finRows[0].direction).toBe('out');
  });
});

// ===========================================================================
// CORPORATE ACTIONS: só patrimony leg — sem fluxo de caixa, sem link forçado
// ===========================================================================
describe('Corporate actions (split/bonus/revaluation): apenas patrimony leg', () => {
  it('split: apenas patrimony leg, sem financial leg', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 52,
      broker_note_ref: 'SPLIT-SETUP',
    });

    // Limpa o estado para contar só o que o split gerou
    const finBefore = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at).length;

    await ops.recordOperation(ctx, {
      date: '2026-05-01',
      ticker: 'VALE3',
      operation: 'split',
      quantity: 300,
      unit_price: 13,
      broker_note_ref: 'SPLIT-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter(
      (r) => !r.deleted_at && r.movement_type === 'split'
    );
    const finAfter = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at).length;

    expect(patRows.length).toBe(1);
    // Nenhuma perna financeira nova criada pelo split
    expect(finAfter).toBe(finBefore);
    // Perna patrimonial SEM link financeiro — correto, não há relação
    expect(patRows[0].related_financial_entry_id).toBeFalsy();
  });

  it('bonus: apenas patrimony leg, sem financial leg', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-01-10',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 50,
      broker_note_ref: 'BONUS-SETUP',
    });

    const finBefore = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at).length;

    await ops.recordOperation(ctx, {
      date: '2026-05-05',
      ticker: 'VALE3',
      operation: 'bonus',
      quantity: 10,
      unit_price: 0,
      broker_note_ref: 'BONUS-1',
    });

    const patRows = gw.dump('patrimony_ledger_entries').filter(
      (r) => !r.deleted_at && r.movement_type === 'bonus'
    );
    const finAfter = gw.dump('financial_ledger_entries').filter((r) => !r.deleted_at).length;

    expect(patRows.length).toBe(1);
    expect(finAfter).toBe(finBefore);
  });
});

// ===========================================================================
// METADATA: target_ticker presente quando ativo é candidato conhecido
// ===========================================================================
describe('Metadata: rastreabilidade por target_ticker', () => {
  it('financial leg de trade inclui patrimony_item_id e target_ticker', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-04-17',
      ticker: 'VALE3',
      operation: 'buy',
      quantity: 100,
      unit_price: 52,
      total_net_value: -5200,
      broker_note_ref: 'META-1',
    });

    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('META-1')
    );

    expect(finRows.length).toBe(1);
    const meta = typeof finRows[0].metadata === 'string'
      ? JSON.parse(finRows[0].metadata)
      : finRows[0].metadata;
    expect(meta.target_ticker).toBe('VALE3');
    expect(meta.patrimony_item_id).toBeTruthy();
  });

  it('financial leg de dividend com ticker não-caixa inclui target_ticker (candidato futuro)', async () => {
    const gw = new InMemoryGateway();
    await seedCatalog(gw);
    const { ops } = buildStack(gw);

    await ops.recordOperation(ctx, {
      date: '2026-04-20',
      ticker: 'VALE3',
      operation: 'dividend',
      quantity: 100,
      unit_price: 2.5,
      total_net_value: 250,
      broker_note_ref: 'META-DIV-1',
    });

    const finRows = gw.dump('financial_ledger_entries').filter(
      (r) => !r.deleted_at && String(r.external_ref ?? '').includes('META-DIV-1')
    );

    expect(finRows.length).toBe(1);
    const meta = typeof finRows[0].metadata === 'string'
      ? JSON.parse(finRows[0].metadata)
      : finRows[0].metadata;
    // target_ticker é a pista para ligação futura quando fonte for identificada
    expect(meta.target_ticker).toBe('VALE3');
    // Sem patrimony_item_id pois não criamos perna patrimonial
    expect(meta.patrimony_item_id).toBeFalsy();
  });
});
