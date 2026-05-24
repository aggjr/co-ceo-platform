import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
import { inferOptionExpiryDate, inferOptionMonthFromTicker } from './optionExpiry';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import { fetchB3Quotes, type B3QuoteResult } from './B3QuoteProvider';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';

export type QuoteSyncResult = {
  asOf: string;
  requested: number;
  updated: number;
  skipped: number;
  missing: string[];
  quotes: B3QuoteResult[];
};

export type SnapshotOptionRow = {
  ticker: string;
  last_price?: number;
  /** Strike de exercício (R$) — do Profit/BTG; não inferir do ticker. */
  option_strike?: number;
};

export class InvestQuoteSyncService {
  private readonly assetProjection: InvestAssetProjection;
  private readonly marketQuotes: MarketQuoteRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.assetProjection = new InvestAssetProjection(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
  }

  /** Tickers de ações/FIIs com posição ou ativos ativos na custódia. */
  async listB3QuoteTickers(ctx: UserContext): Promise<string[]> {
    if (!ctx.organizationId) return [];
    const assets = await this.assetProjection.listActiveAssets(ctx);
    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type || inferAssetType(ticker));
      if (type === 'stock' || type === 'fii') {
        tickers.push(ticker);
      }
    }
    return [...new Set(tickers)];
  }

  async syncFromBrapi(ctx: UserContext, asOfDate?: string): Promise<QuoteSyncResult> {
    if (!ctx.organizationId) {
      throw new Error('organizationId obrigatório.');
    }
    const tickers = await this.listB3QuoteTickers(ctx);
    const quotes = await fetchB3Quotes(tickers, {
      asOfDate,
      token: process.env.BRAPI_TOKEN,
    });
    const quoteByTicker = new Map(quotes.map((q) => [q.ticker, q]));
    const missing: string[] = [];
    let updated = 0;

    const marketCtx = authBootstrapContext();
    for (const ticker of tickers) {
      const q = quoteByTicker.get(ticker);
      if (!q) {
        missing.push(ticker);
        continue;
      }
      await this.marketQuotes.upsertQuote(marketCtx, {
        ticker: q.ticker,
        quoteDate: q.asOf,
        closingPrice: q.price,
        source: 'brapi',
        metadata: { kind: q.kind },
      });
      const ok = await this.writeQuoteToPositionExt(ctx, ticker, q.price, q.asOf);
      if (ok) updated += 1;
    }

    const asOf = asOfDate?.slice(0, 10) || quotes[0]?.asOf || new Date().toISOString().slice(0, 10);
    return {
      asOf,
      requested: tickers.length,
      updated,
      skipped: tickers.length - updated - missing.length,
      missing,
      quotes,
    };
  }

  /** Opções e totais BTG: merge opcional do snapshot manual (sem API pública). */
  async applySnapshotOptions(
    ctx: UserContext,
    items: SnapshotOptionRow[],
    asOf: string
  ): Promise<number> {
    if (!ctx.organizationId) return 0;
    let n = 0;
    const asOfDay = asOf.slice(0, 10);
    for (const item of items) {
      const ticker = item.ticker?.trim().toUpperCase();
      if (!ticker) continue;
      const type = inferAssetType(ticker);
      if (type !== 'option_call' && type !== 'option_put') continue;

      const lastPrice =
        item.last_price != null ? Number(item.last_price) : Number.NaN;
      const strike =
        item.option_strike != null ? Number(item.option_strike) : Number.NaN;
      const hasPrice = Number.isFinite(lastPrice) && lastPrice >= 0;
      const hasStrike = Number.isFinite(strike) && strike > 0;
      if (!hasPrice && !hasStrike) continue;

      let touched = false;
      if (hasPrice) {
        const ok = await this.writeQuoteToPositionExt(ctx, ticker, lastPrice, asOfDay);
        touched = touched || ok;
      }
      if (hasStrike) {
        const ok = await this.writeOptionStrike(ctx, ticker, strike, asOfDay);
        touched = touched || ok;
      }
      if (touched) n += 1;
    }
    return n;
  }

  /**
   * Grava cotacao em invest_position_ext.last_price. Retorna true se atualizou.
   */
  private async writeQuoteToPositionExt(
    ctx: UserContext,
    ticker: string,
    lastPrice: number,
    asOf: string
  ): Promise<boolean> {
    if (!ctx.organizationId) return false;
    const item = await this.gateway.findWhere(
      ctx,
      'patrimony_items',
      {
        organization_id: ctx.organizationId,
        source_module: 'INVEST',
        identifier: ticker,
      },
      { limit: 1 }
    );
    if (!item.length) return false;
    const itemId = String(item[0].id);
    const ext = await this.gateway.findWhere(
      ctx,
      'invest_position_ext',
      { patrimony_item_id: itemId },
      { limit: 1 }
    );
    if (!ext.length) return false;
    await this.gateway.update(ctx, 'invest_position_ext', itemId, {
      last_price: lastPrice,
      last_price_as_of: asOf.slice(0, 10),
    });
    return true;
  }

  /** Atualiza strike de opcao em invest_option_ext. */
  private async writeOptionStrike(
    ctx: UserContext,
    ticker: string,
    strike: number,
    asOf: string
  ): Promise<boolean> {
    if (!ctx.organizationId) return false;
    const item = await this.gateway.findWhere(
      ctx,
      'patrimony_items',
      {
        organization_id: ctx.organizationId,
        source_module: 'INVEST',
        identifier: ticker,
      },
      { limit: 1 }
    );
    if (!item.length) return false;
    const itemId = String(item[0].id);
    const ext = await this.gateway.findWhere(
      ctx,
      'invest_option_ext',
      { patrimony_item_id: itemId },
      { limit: 1 }
    );
    const rounded = Math.round(strike * 10000) / 10000;
    if (ext.length) {
      await this.gateway.update(ctx, 'invest_option_ext', itemId, {
        strike_price: rounded,
      });
      return true;
    }

    const month = inferOptionMonthFromTicker(ticker);
    const expiration = inferOptionExpiryDate(ticker);
    const underlying = inferUnderlyingTicker(ticker);
    if (!month || !expiration || !underlying) return false;

    await this.gateway.insert(ctx, 'invest_option_ext', {
      patrimony_item_id: itemId,
      option_type: month.optionSide === 'call' ? 'CALL' : 'PUT',
      underlying_ticker: underlying,
      strike_price: rounded,
      expiration_date: expiration,
      european_american: 'A',
    });
    return true;
  }
}
