import type { CoCeoDataGateway, UserContext } from '../dal';
import { SYSTEM_INSTALLER_USER_ID } from '../dal/types';
import { inferUnderlyingTicker, isOptionTicker } from './assetClassifier';
import { fetchOpcoesNetOptionsChainAll } from './opcoesNetClient';
import { parseOpcoesNetExpirations, type ParsedOptionMarketRow } from './opcoesNetChainParser';
import { fetchOpcoesNetOptionQuotes } from './opcoesNetQuotes';
import { OptionMarketRepository } from './OptionMarketRepository';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';

export type OptionQuoteSyncReport = {
  date: string;
  tickersInUse: string[];
  quotesSaved: number;
  missing: string[];
  contractsInserted: number;
  contractsUpdated: number;
};

export type OptionMarketSyncReport = {
  underlyings: string[];
  tickersInUse: string[];
  rowsParsed: number;
  rowsKept: number;
  inserted: number;
  updated: number;
  pruned?: number;
  contractsAlreadyKnown?: number;
  quoteSync?: OptionQuoteSyncReport[];
  errors: Array<{ underlying: string; message: string }>;
  cacheHit?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const optionMarketGlobalCtx: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: null,
  impersonatorId: null,
  scope: 'global',
};

const optionMarketRunCache = new Map<string, OptionMarketSyncReport>();
const optionMarketUnderlyingCache = new Set<string>();

function optionMarketCacheKey(ctx: UserContext, underlyings: string[]): string {
  const owner = ctx.organizationId ? `org:${ctx.organizationId}` : 'global';
  return `${owner}|${underlyings.join(',')}`;
}

/**
 * Atualiza invest_options_market a partir do opcoes.net.br para ações-mãe
 * com opções em custódia em qualquer cliente.
 */
export class OptionMarketSyncService {
  private readonly marketRepo: OptionMarketRepository;
  private readonly quotesRepo: MarketQuoteRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.marketRepo = new OptionMarketRepository(gateway);
    this.quotesRepo = new MarketQuoteRepository(gateway);
  }

  /** Custódia real em patrimony_items (não exige invest_position_ext). */
  async listUnderlyingsWithOptionsInUse(ctx: UserContext): Promise<string[]> {
    const tickers = await this.listOptionTickersInUse(ctx);
    return [...new Set(tickers.map((ticker) => inferUnderlyingTicker(ticker)))].sort();
  }

  async listOptionTickersInUse(ctx: UserContext): Promise<string[]> {
    const rows = ctx.organizationId
      ? await this.gateway.readQuery(
          optionMarketGlobalCtx,
          'invest_option_tickers_for_org',
          [ctx.organizationId]
        )
      : await this.gateway.readQuery(optionMarketGlobalCtx, 'invest_option_tickers', []);
    const tickers = new Set<string>();
    for (const row of rows) {
      const ticker = String(row.ticker ?? '').toUpperCase();
      if (!ticker || !isOptionTicker(ticker)) continue;
      tickers.add(ticker);
    }
    return [...tickers].sort();
  }

  async syncFromOpcoesNet(
    ctx: UserContext,
    options?: {
      underlyings?: string[];
      asOfDate?: string;
      delayMs?: number;
      reuseSessionCache?: boolean;
      onlyMissingContracts?: boolean;
      pruneUnused?: boolean;
    }
  ): Promise<OptionMarketSyncReport> {
    const tickersInUse = await this.listOptionTickersInUse(ctx);
    let contractsAlreadyKnown = 0;
    const tickersToSync: string[] = [];
    for (const ticker of tickersInUse) {
      const known = await this.marketRepo.hasContract(optionMarketGlobalCtx, ticker);
      if (known) contractsAlreadyKnown += 1;
      if (!options?.onlyMissingContracts || !known) tickersToSync.push(ticker);
    }
    const tickerAllowList = new Set(tickersToSync);
    const requestedUnderlyings = options?.underlyings?.length
      ? new Set(options.underlyings.map((u) => u.trim().toUpperCase()))
      : null;
    const underlyings =
      requestedUnderlyings
        ? [...requestedUnderlyings].filter(
            (u) => !options?.onlyMissingContracts || tickersToSync.some((t) => inferUnderlyingTicker(t) === u)
          )
        : [...new Set(tickersToSync.map((ticker) => inferUnderlyingTicker(ticker)))].sort();

    const asOfDate = options?.asOfDate ?? new Date().toISOString().slice(0, 10);
    const delayMs = options?.delayMs ?? 400;
    const cacheKey = options?.reuseSessionCache ? optionMarketCacheKey(ctx, underlyings) : null;
    if (cacheKey) {
      const cached = optionMarketRunCache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          inserted: 0,
          updated: 0,
          cacheHit: true,
        };
      }
    }

    let rowsParsed = 0;
    let rowsKept = 0;
    let inserted = 0;
    let updated = 0;
    let pruned = 0;
    const errors: OptionMarketSyncReport['errors'] = [];
    const fetchedUnderlyings: string[] = [];

    for (const underlying of underlyings) {
      const underlyingCacheKey = cacheKey ? optionMarketCacheKey(ctx, [underlying]) : null;
      if (underlyingCacheKey && optionMarketUnderlyingCache.has(underlyingCacheKey)) {
        continue;
      }
      try {
        const expirations = await fetchOpcoesNetOptionsChainAll(underlying);
        const parsed = parseOpcoesNetExpirations(underlying, expirations, asOfDate);
        rowsParsed += parsed.length;
        const scoped = parsed.filter((row) => tickerAllowList.has(row.ticker));
        rowsKept += scoped.length;
        const result = await this.marketRepo.upsertMany(optionMarketGlobalCtx, scoped);
        inserted += result.inserted;
        updated += result.updated;
        if (underlyingCacheKey) optionMarketUnderlyingCache.add(underlyingCacheKey);
        fetchedUnderlyings.push(underlying);
      } catch (err) {
        errors.push({
          underlying,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (delayMs > 0) await sleep(delayMs);
    }

    if (options?.pruneUnused !== false) {
      pruned = await this.marketRepo.pruneUnused(optionMarketGlobalCtx);
    }

    const report = {
      underlyings,
      tickersInUse,
      rowsParsed,
      rowsKept,
      inserted,
      updated,
      pruned,
      contractsAlreadyKnown,
      errors,
      cacheHit: fetchedUnderlyings.length === 0 && errors.length === 0,
    };
    if (cacheKey && errors.length === 0) {
      optionMarketRunCache.set(cacheKey, report);
    }
    return report;
  }

  async syncOpenOptionQuotesFromOpcoesNet(
    ctx: UserContext,
    asOfDate?: string
  ): Promise<OptionQuoteSyncReport> {
    const day = (asOfDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const queryName = ctx.organizationId
      ? 'invest_open_option_tickers_for_org'
      : 'invest_open_option_tickers';
    const rows = await this.gateway.readQuery(
      optionMarketGlobalCtx,
      queryName,
      ctx.organizationId ? [ctx.organizationId] : []
    );
    const tickers = rows
      .map((row) => String(row.ticker ?? '').trim().toUpperCase())
      .filter((ticker) => ticker && isOptionTicker(ticker));
    if (!tickers.length) {
      return {
        date: day,
        tickersInUse: [],
        quotesSaved: 0,
        missing: [],
        contractsInserted: 0,
        contractsUpdated: 0,
      };
    }

    const quotes = await fetchOpcoesNetOptionQuotes(tickers, { asOfDate: day });
    const quoteByTicker = new Map(quotes.map((q) => [q.ticker, q]));
    let quotesSaved = 0;
    const missing: string[] = [];
    const contractRows: ParsedOptionMarketRow[] = [];

    for (const ticker of tickers) {
      const q = quoteByTicker.get(ticker);
      if (!q) {
        missing.push(ticker);
        continue;
      }
      await this.quotesRepo.upsertQuote(optionMarketGlobalCtx, {
        ticker: q.ticker,
        quoteDate: q.asOf,
        closingPrice: q.price,
        source: 'opcoes_net',
        metadata: { kind: 'option_last', scope: 'open_custody' },
      });
      quotesSaved += 1;
      const hasContract = await this.marketRepo.hasContract(optionMarketGlobalCtx, q.ticker);
      if (
        !hasContract &&
        q.strikePrice != null &&
        q.expirationDate &&
        q.optionType &&
        q.underlyingTicker
      ) {
        contractRows.push({
          ticker: q.ticker,
          underlyingTicker: q.underlyingTicker,
          optionType: q.optionType,
          strikePrice: q.strikePrice,
          expirationDate: q.expirationDate,
          europeanAmerican: 'E',
          lastPrice: q.price,
          quoteDate: q.asOf,
        });
      }
    }

    const contractResult = contractRows.length
      ? await this.marketRepo.upsertMany(optionMarketGlobalCtx, contractRows)
      : { inserted: 0, updated: 0 };

    return {
      date: day,
      tickersInUse: tickers,
      quotesSaved,
      missing,
      contractsInserted: contractResult.inserted,
      contractsUpdated: contractResult.updated,
    };
  }
}
