import { InventoryLedger } from '../../../../src/core/inventory/InventoryLedger';
import { InventoryRegistry } from '../../../../src/core/inventory/InventoryRegistry';
import { ValuationFactory } from '../../../../src/core/inventory/valuation/ValuationFactory';
import { ModuleCategories } from '../../../../src/core/module-registry/ModuleCategories';
import { ContractGuard } from '../../../../src/core/module-registry/ContractGuard';
import { SYSTEM_INSTALLER_USER_ID, type UserContext } from '../../../../src/core/dal/types';
import { InMemoryGateway, castGateway } from '../../core/business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: 'org-test-001',
  impersonatorId: null,
  scope: 'node',
};

async function seedCatalog(gw: InMemoryGateway): Promise<void> {
  await gw.insert(ctx, 'module_categories', {
    module_code: 'INVEST',
    category: 'financial_asset',
    subcategory: 'stock',
    default_valuation_method: 'weighted_avg',
    default_quantity_unit: 'shares',
    is_active: 1,
  });
  await gw.insert(ctx, 'module_valuation_methods', {
    method_code: 'weighted_avg',
    is_active: 1,
  });
}

function buildDeps(gw: InMemoryGateway) {
  const gateway = castGateway(gw);
  const categories = new ModuleCategories(gateway);
  const contractGuard = new ContractGuard(gateway, categories);
  const valuationFactory = new ValuationFactory(categories);
  const registry = new InventoryRegistry(gateway, categories, contractGuard);
  const ledger = new InventoryLedger(gateway, registry, valuationFactory);
  return { gw, gateway, registry, ledger };
}

async function createItem(
  registry: InventoryRegistry,
  identifier: string
): Promise<string> {
  const { item } = await registry.ensure(ctx, {
    category: 'financial_asset',
    subcategory: 'stock',
    identifier,
    name: identifier,
    quantityUnit: 'shares',
  });
  return item.id;
}

describe('InventoryLedger — transicoes de status', () => {
  describe('Cenario A: active → liquidated (zeragem de posicao)', () => {
    it('deve setar status=liquidated quando qty vai a zero', async () => {
      const gw = new InMemoryGateway();
      await seedCatalog(gw);
      const { registry, ledger } = buildDeps(gw);

      const itemId = await createItem(registry, 'PRIO3-A');

      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-01-10',
        movementType: 'opening_balance',
        quantityDelta: 100,
        unitValue: 50,
      });

      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-02-01',
        movementType: 'disposition',
        quantityDelta: -100,
        unitValue: 55,
      });

      const snapshot = await registry.findById(ctx, itemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.quantity).toBe(0);
      expect(snapshot!.status).toBe('liquidated');
    });
  });

  describe('Cenario B: active → liquidated → active (reabertura)', () => {
    it('deve setar status=active quando qty volta de zero apos liquidacao', async () => {
      const gw = new InMemoryGateway();
      await seedCatalog(gw);
      const { registry, ledger } = buildDeps(gw);

      const itemId = await createItem(registry, 'PRIO3-B');

      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-01-10',
        movementType: 'opening_balance',
        quantityDelta: 100,
        unitValue: 50,
      });

      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-02-01',
        movementType: 'disposition',
        quantityDelta: -100,
        unitValue: 55,
      });

      // Confirma estado intermediario: liquidado
      const intermediate = await registry.findById(ctx, itemId);
      expect(intermediate!.quantity).toBe(0);
      expect(intermediate!.status).toBe('liquidated');

      // Reabre a posicao
      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-03-15',
        movementType: 'acquisition',
        quantityDelta: 50,
        unitValue: 48,
      });

      const snapshot = await registry.findById(ctx, itemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.quantity).toBe(50);
      // BUG corrigido: status deve voltar a 'active', nao ficar 'liquidated'
      expect(snapshot!.status).toBe('active');
    });
  });

  describe('Cenario C: active → active (status nao deve mudar em movimentacao normal)', () => {
    it('nao deve alterar status em aquisicao adicional sobre posicao ja aberta', async () => {
      const gw = new InMemoryGateway();
      await seedCatalog(gw);
      const { registry, ledger } = buildDeps(gw);

      const itemId = await createItem(registry, 'PRIO3-C');

      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-01-10',
        movementType: 'opening_balance',
        quantityDelta: 100,
        unitValue: 50,
      });

      await ledger.recordMovement(ctx, {
        itemId,
        transactionDate: '2026-02-01',
        movementType: 'acquisition',
        quantityDelta: 50,
        unitValue: 52,
      });

      const snapshot = await registry.findById(ctx, itemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.quantity).toBe(150);
      expect(snapshot!.status).toBe('active');
    });
  });
});
