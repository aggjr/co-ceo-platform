import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { inferAssetType } from './assetClassifier';
import { fetchB3Quotes, type B3QuoteResult } from './B3QuoteProvider';

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

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
  } catch {
    return {};
  }
}

export class InvestQuoteSyncService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /** Tickers de ações/FIIs com posição ou ativos ativos na custódia. */
  async listB3QuoteTickers(ctx: UserContext): Promise<string[]> {
    if (!ctx.organizationId) return [];
    const assets = await this.gateway.findWhere(ctx, 'invest_assets', {
      organization_id: ctx.organizationId,
      status: 'active',
    });
    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type || inferAssetType(ticker));
      if (type === 'stock' || type === 'fii') {
        if (Math.abs(Number(row.current_quantity ?? 0)) > 0.0001 || type === 'stock' || type === 'fii') {
          tickers.push(ticker);
        }
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

    for (const ticker of tickers) {
      const q = quoteByTicker.get(ticker);
      if (!q) {
        missing.push(ticker);
        continue;
      }
      const assets = await this.gateway.findWhere(
        ctx,
        'invest_assets',
        { organization_id: ctx.organizationId, asset_ticker: ticker },
        { limit: 1 }
      );
      const row = assets[0];
      if (!row?.id) continue;

      const meta = parseMetadata(row.metadata);
      meta.last_price = q.price;
      meta.quote_as_of = q.asOf;
      meta.quote_source = q.source;
      meta.quote_kind = q.kind;
      await this.gateway.update(ctx, 'invest_assets', String(row.id), {
        metadata: JSON.stringify(meta),
      });
      updated += 1;
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

      const assets = await this.gateway.findWhere(
        ctx,
        'invest_assets',
        { organization_id: ctx.organizationId, asset_ticker: ticker },
        { limit: 1 }
      );
      const row = assets[0];
      if (!row?.id) continue;

      const meta = parseMetadata(row.metadata);
      if (hasPrice) {
        meta.last_price = lastPrice;
        meta.quote_as_of = asOfDay;
        meta.quote_source = 'btg_snapshot';
      }
      if (hasStrike) {
        meta.option_strike = Math.round(strike * 10000) / 10000;
        meta.option_strike_as_of = asOfDay;
      }
      await this.gateway.update(ctx, 'invest_assets', String(row.id), {
        metadata: JSON.stringify(meta),
      });
      n += 1;
    }
    return n;
  }
}
