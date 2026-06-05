import type { UserContext } from '../../../../src/core/dal';
import { ModuleCategories } from '../../../../src/core/module-registry';
import {
  InMemoryGateway,
  castGateway,
} from '../business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: 'u-test',
  organizationId: 'org-test',
  impersonatorId: null,
  scope: 'node',
};

describe('ModuleCategories quote and patrimony flags', () => {
  it('loads patrimony and quote behavior from module_categories', async () => {
    const gw = new InMemoryGateway();
    await gw.insert(ctx, 'module_categories', {
      module_code: 'INVEST',
      category: 'financial_asset',
      subcategory: 'etf',
      canonical_name: 'ETF',
      default_quantity_unit: 'cota',
      default_valuation_method: 'three_prices_invest',
      default_settlement_profile: 'B3_D2',
      contributes_to_patrimony: 1,
      requires_market_quote: 1,
      default_quote_source: 'brapi',
      valuation_mode: 'market_price',
      is_active: 1,
    });

    const categories = new ModuleCategories(castGateway(gw));

    await expect(categories.contributesToPatrimony(ctx, 'etf')).resolves.toBe(true);
    await expect(categories.requiresMarketQuote(ctx, 'etf')).resolves.toBe(true);
    await expect(categories.defaultQuoteSource(ctx, 'etf')).resolves.toBe('brapi');
    await expect(categories.requiresMarketQuote(ctx, 'unknown_subcategory')).resolves.toBe(false);
  });
});
