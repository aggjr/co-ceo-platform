import { randomUUID } from 'crypto';
import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import {
  inferAssetType,
  inferUnderlyingTicker,
  isOptionTicker,
} from './assetClassifier';
import { inferOptionExpiryDate, inferOptionMonthFromTicker } from './optionExpiry';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import { fetchB3Quotes, type B3QuoteResult } from './B3QuoteProvider';
import { fetchOptionQuotesWithFallback } from './opcoesNetQuotes';
import { MarketQuoteRepository, type QuoteSource } from '../market/MarketQuoteRepository';
import {
  fetchExternalStockHistory,
  fetchExternalStockQuoteForDate,
} from '../market/ExternalStockQuoteProvider';
import { fetchTesouroDiretoQuotes } from './TesouroDiretoQuoteProvider';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';
import { FxRateRepository } from '../market/FxRateRepository';
import {
  AssetValuationContext,
  type AssetValuationSnapshot,
  quoteSourceForAsset,
  requiresMarketQuoteForAsset,
} from './valuation/AssetValuationContext';

export type QuoteSyncQuote = {
  ticker: string;
  price: number;
  asOf: string;
  source: QuoteSource;
  kind: string;
  provider?: string;
  /** Dados do contrato de opção (quando disponíveis via opcoes_net) */
  strikePrice?: number | null;
  expirationDate?: string | null;
  optionType?: 'CALL' | 'PUT' | null;
  underlyingTicker?: string | null;
};

export type QuoteSyncResult = {
  asOf: string;
  requested: number;
  updated: number;
  skipped: number;
  missing: string[];
  quotes: QuoteSyncQuote[];
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
  private readonly fxRates: FxRateRepository;
  private readonly valuation: AssetValuationContext;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.assetProjection = new InvestAssetProjection(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
    this.fxRates = new FxRateRepository(gateway);
    this.valuation = new AssetValuationContext(gateway);
  }

  private addQuoteTarget(targets: Map<string, Set<string>>, source: string | null, ticker: string): void {
    const cleanSource = String(source || '').trim();
    const cleanTicker = String(ticker || '').trim().toUpperCase();
    if (!cleanSource || !cleanTicker || cleanTicker.startsWith('CAIXA-')) return;
    const list = targets.get(cleanSource) ?? new Set<string>();
    list.add(cleanTicker);
    targets.set(cleanSource, list);
  }

  private addCategoryQuoteTarget(
    targets: Map<string, Set<string>>,
    ticker: string,
    subcategory: string,
    snapshot: AssetValuationSnapshot
  ): void {
    if (!requiresMarketQuoteForAsset(snapshot, subcategory, ticker)) return;
    this.addQuoteTarget(targets, quoteSourceForAsset(snapshot, subcategory, ticker), ticker);
  }

  private async listQuoteTargetsBySource(ctx: UserContext): Promise<Map<string, Set<string>>> {
    if (!ctx.organizationId) return new Map();
    const assets = await this.assetProjection.listActiveAssets(ctx);
    const snapshot = await this.valuation.load(ctx);
    const targets = new Map<string, Set<string>>();
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const subcategory = String(row.asset_type || inferAssetType(ticker));
      this.addCategoryQuoteTarget(targets, ticker, subcategory, snapshot);

      const underlying = inferUnderlyingTicker(ticker);
      if (underlying) {
        this.addCategoryQuoteTarget(targets, underlying, inferAssetType(underlying), snapshot);
      }
    }
    return targets;
  }

  /** Compatibilidade: tickers cujo catálogo aponta para a fonte brapi. */
  async listB3QuoteTickers(ctx: UserContext): Promise<string[]> {
    const targets = await this.listQuoteTargetsBySource(ctx);
    return [...(targets.get('brapi') ?? new Set<string>())];
  }

  private quoteSourceForStorage(source: string): QuoteSource {
    const allowed = new Set<QuoteSource>([
      'brapi',
      'opcoes_net',
      'tesouro_direto',
      'computed_cdi',
      'computed_pre',
      'computed_ipca',
      'yahoo_finance',
      'coingecko',
      'user_manual',
    ]);
    return allowed.has(source as QuoteSource) ? (source as QuoteSource) : 'user_manual';
  }

  private async fetchQuotesForSource(
    source: string,
    tickers: string[],
    asOfDate?: string
  ): Promise<QuoteSyncQuote[]> {
    if (!tickers.length) return [];
    if (source === 'brapi') {
      const brapiQuotes = await fetchB3Quotes(tickers, {
        asOfDate,
        token: process.env.BRAPI_TOKEN,
      });
      const out: QuoteSyncQuote[] = brapiQuotes.map((q) => ({
        ticker: q.ticker,
        price: q.price,
        asOf: q.asOf,
        source: 'brapi',
        kind: q.kind,
      }));
      if (asOfDate) {
        const found = new Set(out.map((q) => q.ticker));
        for (const ticker of tickers) {
          if (found.has(ticker)) continue;
          const fallback = await fetchExternalStockQuoteForDate(ticker, asOfDate).catch(() => null);
          if (!fallback) continue;
          out.push({
            ticker: fallback.ticker,
            price: fallback.price,
            asOf: fallback.asOf,
            source: this.quoteSourceForStorage(fallback.source),
            kind: fallback.kind,
            provider: fallback.source,
          });
        }
      }
      return out;
    }
    if (source === 'opcoes_net') {
      const optionQuotes = await fetchOptionQuotesWithFallback(tickers, { asOfDate });
      return optionQuotes.map((q) => ({
        ticker: q.ticker,
        price: q.price,
        asOf: q.asOf,
        source: q.source,
        kind: 'option_last',
        provider: q.provider,
        strikePrice: q.strikePrice,
        expirationDate: q.expirationDate,
        optionType: q.optionType,
        underlyingTicker: q.underlyingTicker,
      }));
    }
    if (source === 'tesouro_direto') {
      const tesouroQuotes = await fetchTesouroDiretoQuotes(tickers, { asOfDate });
      return tesouroQuotes.map((q) => ({
        ticker: q.ticker,
        price: q.price,
        asOf: q.asOf,
        source: q.source,
        kind: q.kind,
        provider: q.provider,
      }));
    }
    if (source === 'yahoo_finance') {
      const out: QuoteSyncQuote[] = [];
      if (!asOfDate) return out;
      for (const ticker of tickers) {
        const q = await fetchExternalStockQuoteForDate(ticker, asOfDate).catch(() => null);
        if (!q) continue;
        out.push({
          ticker: q.ticker,
          price: q.price,
          asOf: q.asOf,
          source: this.quoteSourceForStorage(q.source),
          kind: q.kind,
          provider: q.source,
        });
      }
      return out;
    }
    if (source === 'coingecko') {
      const { fetchCoinGeckoQuote } = await import('./coinGeckoQuotes');
      const out: QuoteSyncQuote[] = [];
      if (!asOfDate) return out;
      const usdBrl = await this.fxRates.getClosingRate('USD', 'BRL', asOfDate).catch(() => null);
      if (usdBrl == null || !Number.isFinite(usdBrl) || usdBrl <= 0) {
        return out;
      }
      for (const ticker of tickers) {
        const q = await fetchCoinGeckoQuote(this.gateway, ticker, asOfDate).catch(() => null);
        if (!q) continue;
        out.push({
          ticker: q.ticker,
          price: Math.round(q.priceUsd * usdBrl * 1000000) / 1000000,
          asOf: q.asOf,
          source: 'coingecko',
          kind: 'crypto_close',
          provider: `coingecko:${q.providerSymbol}`,
        });
      }
      return out;
    }
    console.warn(`[InvestQuoteSyncService] fonte de cotacao sem adaptador ativo: ${source}`);
    return [];
  }

  async syncFromBrapi(ctx: UserContext, asOfDate?: string): Promise<QuoteSyncResult> {
    if (!ctx.organizationId) {
      throw new Error('organizationId obrigatório.');
    }
    const targetsBySource = await this.listQuoteTargetsBySource(ctx);
    const requested = [...targetsBySource.values()].reduce((sum, tickers) => sum + tickers.size, 0);
    const quotes: QuoteSyncQuote[] = [];
    const missing: string[] = [];
    let updated = 0;

    const marketCtx = authBootstrapContext();
    for (const [source, tickerSet] of targetsBySource.entries()) {
      const tickers = [...tickerSet];
      let sourceQuotes: QuoteSyncQuote[] = [];
      try {
        sourceQuotes = await this.fetchQuotesForSource(source, tickers, asOfDate);
      } catch (err) {
        console.warn(`[syncFromBrapi] ${source}:`, err);
      }
      const quoteByTicker = new Map(sourceQuotes.map((q) => [q.ticker, q]));
      quotes.push(...sourceQuotes);
      for (const ticker of tickers) {
        const q = quoteByTicker.get(ticker);
        if (!q) {
          missing.push(`${ticker}:${source}`);
          continue;
        }
        await this.marketQuotes.upsertQuote(marketCtx, {
          ticker: q.ticker,
          quoteDate: q.asOf,
          closingPrice: q.price,
          source: q.source,
          metadata: q.provider
            ? { kind: q.kind, provider: q.provider, requested_source: source }
            : { kind: q.kind, requested_source: source },
        });
        // Para opções: popular market_instruments com dados do contrato (strike, vencimento)
        if (
          source === 'opcoes_net' &&
          q.strikePrice != null &&
          q.expirationDate &&
          q.optionType &&
          q.underlyingTicker
        ) {
          await this.upsertOptionToMarketInstruments(
            marketCtx,
            q.ticker,
            q.strikePrice,
            q.expirationDate,
            q.optionType,
            q.underlyingTicker
          ).catch((err) => console.warn('[syncFromBrapi] market_instruments upsert:', err));
        }
        const ok = await this.writeQuoteToPositionExt(ctx, ticker, q.price, q.asOf);
        if (ok) updated += 1;
      }
    }

    const asOf = asOfDate?.slice(0, 10) || quotes[0]?.asOf || new Date().toISOString().slice(0, 10);
    return {
      asOf,
      requested,
      updated,
      skipped: Math.max(0, requested - updated - missing.length),
      missing,
      quotes,
    };
  }

  async syncHistoricalFromBrapi(ctx: UserContext): Promise<number> {
    if (!ctx.organizationId) throw new Error('organizationId obrigatório.');
    const tickers = await this.listB3QuoteTickers(ctx);
    if (!tickers.length) return 0;
    
    let quotes: B3QuoteResult[] = [];
    try {
      quotes = await fetchB3Quotes(tickers, {
        returnAllHistory: true,
        token: process.env.BRAPI_TOKEN,
      });
    } catch (err) {
      console.warn('[syncHistoricalFromBrapi] brapi historico:', err);
    }
    
    let updated = 0;
    const marketCtx = authBootstrapContext();
    for (const q of quotes) {
      await this.marketQuotes.upsertQuote(marketCtx, {
        ticker: q.ticker,
        quoteDate: q.asOf,
        closingPrice: q.price,
        source: 'brapi',
        metadata: { kind: q.kind },
      });
      updated++;
    }
    const to = new Date().toISOString().slice(0, 10);
    // Sem data de cliente no codigo: janela movel padrao (24 meses) quando o
    // override de ambiente nao esta definido.
    const defaultHistoryFrom = (() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 24);
      return d.toISOString().slice(0, 10);
    })();
    const from = (process.env.INVEST_QUOTES_HISTORY_FROM || defaultHistoryFrom).slice(0, 10);
    for (const ticker of tickers) {
      const bars = await fetchExternalStockHistory(ticker, from, to).catch(() => []);
      for (const q of bars) {
        await this.marketQuotes.upsertQuote(marketCtx, {
          ticker: q.ticker,
          quoteDate: q.asOf,
          closingPrice: q.price,
          source: 'user_manual',
          metadata: {
            kind: q.kind,
            provider: q.source,
            fallback_for: 'brapi',
            backfill: true,
          },
        });
        updated++;
      }
    }
    return updated;
  }

  /** Atualiza last_price em invest_position_ext (ações, opções, FIIs). */
  async applyLastPrices(
    ctx: UserContext,
    items: Array<{ ticker: string; last_price: number }>,
    asOf: string
  ): Promise<number> {
    if (!ctx.organizationId) return 0;
    let n = 0;
    const asOfDay = asOf.slice(0, 10);
    for (const item of items) {
      const ticker = item.ticker?.trim().toUpperCase();
      const lastPrice = Number(item.last_price);
      if (!ticker || !Number.isFinite(lastPrice) || lastPrice < 0) continue;
      const ok = await this.writeQuoteToPositionExt(ctx, ticker, lastPrice, asOfDay);
      if (ok) n += 1;
    }
    return n;
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
   * Grava cotacao em invest_position_ext.last_price.
   * Se o registro nao existe ainda, cria com dados minimos + last_price.
   * Retorna true se gravou ou atualizou.
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
    const asOfDay = asOf.slice(0, 10);
    const ext = await this.gateway.findWhere(
      ctx,
      'invest_position_ext',
      { patrimony_item_id: itemId },
      { limit: 1 }
    );
    if (!ext.length) {
      // Cria o registro de extensao com dados minimos + last_price
      const assetClass = inferAssetType(ticker);
      const underlying = inferUnderlyingTicker(ticker);
      await this.gateway.insert(ctx, 'invest_position_ext', {
        patrimony_item_id: itemId,
        organization_id: ctx.organizationId,
        asset_class: assetClass,
        underlying_ticker: underlying ?? null,
        last_price: lastPrice,
        last_price_as_of: asOfDay,
      });
      return true;
    }
    await this.gateway.update(ctx, 'invest_position_ext', itemId, {
      last_price: lastPrice,
      last_price_as_of: asOfDay,
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

  /**
   * Popula market_instruments com os dados do contrato de uma opção (strike, vencimento, tipo).
   * Tabela global: sem organization_id. Usa authBootstrapContext passado como marketCtx.
   */
  private async upsertOptionToMarketInstruments(
    marketCtx: UserContext,
    ticker: string,
    strikePrice: number,
    expirationDate: string,
    optionType: 'CALL' | 'PUT',
    underlyingTicker: string
  ): Promise<void> {
    const instrumentType = optionType === 'CALL' ? 'option_call' : 'option_put';
    const existing = await this.gateway.findWhere(
      marketCtx,
      'market_instruments',
      { ticker },
      { limit: 1, columns: ['ticker'] }
    );
    const payload = {
      instrument_type: instrumentType,
      underlying_ticker: underlyingTicker.trim().toUpperCase(),
      maturity_date: expirationDate.slice(0, 10),
      strike_price: Math.round(strikePrice * 10000) / 10000,
      last_synced_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      metadata: JSON.stringify({ option_type: optionType, source: 'opcoes_net' }),
    };
    if (existing.length) {
      await this.gateway.update(marketCtx, 'market_instruments', ticker, payload);
    } else {
      await this.gateway.insert(marketCtx, 'market_instruments', { ticker, ...payload });
    }
  }
}
