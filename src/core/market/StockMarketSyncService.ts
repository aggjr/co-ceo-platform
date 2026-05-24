import type { CoCeoDataGateway, UserContext } from '../dal';
import { inferAssetType } from '../invest/assetClassifier';
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
    const allInUse = await this.repo.listTickersInUse(ctx);
    const tickers = allInUse.filter((t) => {
      const kind = inferAssetType(t);
      return kind === 'stock' || kind === 'fii' || kind === 'etf' || kind === 'bdr';
    });
    if (!tickers.length) {
      return {
        asOf: asOfDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        tickersInUse: 0,
        quotesReceived: 0,
        saved: 0,
        missing: [],
      };
    }

    let saved = 0;
    const got = new Set<string>();
    const missing: string[] = [];
    let quotesReceived = 0;

    for (const ticker of tickers) {
      try {
        const batch = await fetchB3Quotes([ticker], {
          asOfDate,
          token: process.env.BRAPI_TOKEN,
        });
        quotesReceived += batch.length;
        const q = batch[0];
        if (!q) {
          missing.push(ticker);
          continue;
        }
        await this.repo.upsertQuote(ctx, {
          ticker: q.ticker,
          quoteDate: q.asOf,
          closingPrice: q.price,
          source: 'brapi',
          metadata: { kind: q.kind },
        });
        got.add(q.ticker);
        saved += 1;
      } catch {
        missing.push(ticker);
      }
    }

    return {
      asOf: asOfDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      tickersInUse: tickers.length,
      quotesReceived,
      saved,
      missing,
    };
  }
}
