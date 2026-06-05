import type { UserContext } from '../../../../src/core/dal';
import { MarketQuoteRepository } from '../../../../src/core/market/MarketQuoteRepository';
import {
  InMemoryGateway,
  castGateway,
} from '../business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-test-001',
  impersonatorId: null,
  scope: 'node',
};

describe('MarketQuoteRepository', () => {
  it('getHistoricalClose retorna cotacao historica exata local', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'market_quotes_daily', {
      id: 'quote-1',
      ticker: 'PRIO3',
      quote_date: '2026-01-05',
      closing_price: 42.5,
      source: 'brapi',
    });

    const repo = new MarketQuoteRepository(gateway);

    await expect(repo.getHistoricalClose(ctx, 'PRIO3', '2026-01-05')).resolves.toEqual({
      price: 42.5,
      source: 'brapi',
    });
  });

  it('getHistoricalClose nao usa last_price/current_price como fallback historico', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'invest_position_ext', {
      id: 'ext-1',
      patrimony_item_id: 'item-1',
      last_price: 99,
      asset_ticker: 'PRIO3',
    });

    const repo = new MarketQuoteRepository(gateway);

    await expect(repo.getHistoricalClose(ctx, 'PRIO3', '2026-01-05')).resolves.toBeNull();
  });
});
