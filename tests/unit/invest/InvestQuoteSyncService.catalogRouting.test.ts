import type { UserContext } from '../../../src/core/dal';
import { InvestQuoteSyncService } from '../../../src/core/invest/InvestQuoteSyncService';
import { fetchB3Quotes } from '../../../src/core/invest/B3QuoteProvider';
import { fetchOpcoesNetOptionQuotes } from '../../../src/core/invest/opcoesNetQuotes';
import {
  InMemoryGateway,
  castGateway,
} from '../core/business-events/inMemoryGateway';

jest.mock('../../../src/core/invest/B3QuoteProvider', () => ({
  fetchB3Quotes: jest.fn(),
}));

jest.mock('../../../src/core/invest/opcoesNetQuotes', () => ({
  fetchOpcoesNetOptionQuotes: jest.fn(),
}));

const ctx: UserContext = {
  userId: 'u-test',
  organizationId: 'org-test',
  impersonatorId: null,
  scope: 'node',
};

async function seedCategory(
  gw: InMemoryGateway,
  subcategory: string,
  defaultQuoteSource: string | null,
  requiresMarketQuote = true
) {
  await gw.insert(ctx, 'module_categories', {
    module_code: 'INVEST',
    category: 'financial_asset',
    subcategory,
    canonical_name: subcategory,
    default_quantity_unit: 'un',
    default_valuation_method: 'three_prices_invest',
    default_settlement_profile: 'B3_D2',
    contributes_to_patrimony: 1,
    requires_market_quote: requiresMarketQuote ? 1 : 0,
    default_quote_source: defaultQuoteSource,
    valuation_mode: requiresMarketQuote ? 'market_price' : 'computed',
    is_active: 1,
  });
}

async function seedAsset(gw: InMemoryGateway, ticker: string, subcategory: string) {
  await gw.insert(ctx, 'patrimony_items', {
    id: ticker,
    source_module: 'INVEST',
    category: 'financial_asset',
    subcategory,
    identifier: ticker,
    name: ticker,
    status: 'active',
    quantity_unit: 'un',
    current_quantity: 1,
    unit_value: 1,
    acquisition_value: 1,
    current_value: 1,
  });
  await gw.insert(ctx, 'invest_position_ext', {
    id: ticker,
    patrimony_item_id: ticker,
    last_price: 0,
    last_price_as_of: null,
  });
}

describe('InvestQuoteSyncService catalog routing', () => {
  beforeEach(() => {
    jest.mocked(fetchB3Quotes).mockReset();
    jest.mocked(fetchOpcoesNetOptionQuotes).mockReset();
  });

  it('routes quote targets by module_categories instead of stock/fii hardcode', async () => {
    const gw = new InMemoryGateway();
    await seedCategory(gw, 'stock', 'brapi');
    await seedCategory(gw, 'etf', 'brapi');
    await seedCategory(gw, 'option_call', 'opcoes_net');
    await seedAsset(gw, 'BOVA11', 'etf');
    await seedAsset(gw, 'ITUBF420', 'option_call');

    jest.mocked(fetchB3Quotes).mockResolvedValue([
      { ticker: 'BOVA11', price: 120, asOf: '2026-06-05', source: 'brapi', kind: 'close' },
      { ticker: 'ITUB4', price: 39.5, asOf: '2026-06-05', source: 'brapi', kind: 'close' },
    ]);
    jest.mocked(fetchOpcoesNetOptionQuotes).mockResolvedValue([
      { ticker: 'ITUBF420', price: 0.42, asOf: '2026-06-05' },
    ]);

    const report = await new InvestQuoteSyncService(castGateway(gw)).syncFromBrapi(
      ctx,
      '2026-06-05'
    );

    expect(fetchB3Quotes).toHaveBeenCalledWith(
      expect.arrayContaining(['BOVA11', 'ITUB4']),
      expect.objectContaining({ asOfDate: '2026-06-05' })
    );
    expect(fetchOpcoesNetOptionQuotes).toHaveBeenCalledWith(
      ['ITUBF420'],
      { asOfDate: '2026-06-05' }
    );
    expect(report.requested).toBe(3);
    expect(report.missing).toEqual([]);
    expect(gw.dump('market_quotes_daily').map((r) => r.ticker).sort()).toEqual([
      'BOVA11',
      'ITUB4',
      'ITUBF420',
    ]);
  });
});
