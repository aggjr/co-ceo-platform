import type { CoCeoDataGateway, UserContext } from '../dal';
import { fetchB3Quotes } from '../invest/B3QuoteProvider';
import { MarketQuoteRepository } from './MarketQuoteRepository';

export type StockMarketSyncReport = {
  asOf: string;
  tickersInUse: number;
  quotesReceived: number;
  saved: number;
  missing: string[];
};

/**
 * Cotações de ações/FIIs em market_quotes_daily (global, compartilhado entre clientes).
 */
export class StockMarketSyncService {
  private readonly repo: MarketQuoteRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.repo = new MarketQuoteRepository(gateway);
  }

  async syncFromBrapi(ctx: UserContext, asOfDate?: string): Promise<StockMarketSyncReport> {
    const tickers = await this.repo.listTickersInUse(ctx);
    if (!tickers.length) {
      return {
        asOf: asOfDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        tickersInUse: 0,
        quotesReceived: 0,
        saved: 0,
        missing: [],
      };
    }

    const quotes = await fetchB3Quotes(tickers, {
      asOfDate,
      token: process.env.BRAPI_TOKEN,
    });

    let saved = 0;
    for (const q of quotes) {
      await this.repo.upsertQuote(ctx, {
        ticker: q.ticker,
        quoteDate: q.asOf,
        closingPrice: q.price,
        source: 'brapi',
        metadata: { kind: q.kind },
      });
      saved += 1;
    }

    const got = new Set(quotes.map((q) => q.ticker));
    const missing = tickers.filter((t) => !got.has(t));

    return {
      asOf: asOfDate?.slice(0, 10) || quotes[0]?.asOf || new Date().toISOString().slice(0, 10),
      tickersInUse: tickers.length,
      quotesReceived: quotes.length,
      saved,
      missing,
    };
  }
}
