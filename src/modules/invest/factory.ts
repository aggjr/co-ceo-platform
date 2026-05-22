import type { CoCeoDataGateway } from '../../core/dal';
import {
  InventoryLedger,
  InventoryRegistry,
  ValuationFactory,
} from '../../core/inventory';
import {
  FinancialAccountRegistry,
  FinancialLedger,
  SettlementEngine,
} from '../../core/financial';
import { ContractGuard, ModuleCategories } from '../../core/module-registry';
import { BusinessEventRegistry } from '../../core/business-events';
import { InvestOperations } from './InvestOperations';
import { ThreePricesValuation } from './ThreePricesValuation';

/**
 * Monta o orquestrador InvestOperations com todas as dependencias do nucleo
 * resolvidas. Use isto em controllers, scripts e testes.
 *
 * Cada chamada cria instancias novas (escopo do request/script). O cache de
 * ModuleCategories e ContractGuard fica no escopo dessas instancias.
 */
export function buildInvestOperations(gateway: CoCeoDataGateway): InvestOperations {
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

  return new InvestOperations(
    gateway,
    inventoryRegistry,
    inventoryLedger,
    accountRegistry,
    financialLedger,
    businessEvents
  );
}
