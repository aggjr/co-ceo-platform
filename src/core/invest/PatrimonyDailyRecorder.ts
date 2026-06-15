import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { LedgerImportService } from './LedgerImportService';
import { InvestBookPeriodService } from './InvestBookPeriodService';
import { buildDailyPatrimonyMtmSeries } from './PatrimonyMtmDailyEngine';
import { interpolatePatrimonyTarget } from './patrimonyAnchors';
import { PatrimonyMonthlyAnchorsRepository } from './PatrimonyMonthlyAnchorsRepository';
import { fixedIncomeTotalFromLedger, shouldUseBtgAnchorCalibration } from './patrimonyLedgerGates';
import { resolveInvestPeriodBounds } from './investPeriodBounds';
import { PatrimonyDailyStore, type StoredPortfolioDay } from './PatrimonyDailyStore';
import { aggregateExternalFlowsByDate } from './portfolioPerformance';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import { inferAssetType, isOptionTicker } from './assetClassifier';
import {
  AssetValuationContext,
  requiresMarketQuoteForAsset,
} from './valuation/AssetValuationContext';
import { FxRateRepository } from '../market/FxRateRepository';
import { InvestOperationPolicyService } from './InvestOperationPolicyService';
import { inferOptionExpiryDate } from './optionExpiry';
import { loadOptionMarketCatalog } from './optionMarketCatalog';

export type RecordDailyPatrimonyResult = {
  snapshotDate: string;
  recorded: StoredPortfolioDay;
  positionsSaved: number;
  quotesAsOf: string | null;
  economicPatrimony: number;
  btgPatrimony: number | null;
};

export class PatrimonyDailyRecorder {
  private readonly ledger: LedgerImportService;
  private readonly store: PatrimonyDailyStore;
  private readonly assetProjection: InvestAssetProjection;
  private readonly marketQuotes: MarketQuoteRepository;
  private readonly anchorsRepo: PatrimonyMonthlyAnchorsRepository;
  private readonly valuationContext: AssetValuationContext;
  private readonly fxRates: FxRateRepository;
  private readonly policyService: InvestOperationPolicyService;
  private readonly periods: InvestBookPeriodService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.store = new PatrimonyDailyStore(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
    this.anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
    this.valuationContext = new AssetValuationContext(gateway);
    this.fxRates = new FxRateRepository(gateway);
    this.policyService = new InvestOperationPolicyService(gateway);
    this.periods = new InvestBookPeriodService(gateway);
  }

  private isWeekend(iso: string): boolean {
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return dow === 0 || dow === 6;
  }

  private requiresExactDailyQuote(assetType: string, ticker: string): boolean {
    const type = assetType.toLowerCase();
    if (type === 'fixed_income') return false;
    if (type === 'option_call' || type === 'option_put' || type.includes('option')) return false;
    if (isOptionTicker(ticker)) return false;
    return true;
  }

  private async quotedTickersOpenOnDate(
    ctx: UserContext,
    events: Array<Record<string, unknown>>,
    date: string
  ): Promise<string[]> {
    const qtyByTicker = new Map<string, number>();
    const valuationSnapshot = await this.valuationContext.load(ctx);
    const sorted = [...events].sort((a, b) =>
      String(a.transaction_date ?? '').localeCompare(String(b.transaction_date ?? ''))
    );
    for (const e of sorted) {
      const eventDate = String(e.transaction_date ?? '').slice(0, 10);
      if (!eventDate || eventDate > date) continue;
      const ticker = String(e.asset_ticker ?? '').trim().toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const assetType = String(e.asset_type || inferAssetType(ticker));
      const expiry = isOptionTicker(ticker)
        ? inferOptionExpiryDate(ticker, Number(date.slice(0, 4)))
        : null;
      if (expiry && date >= expiry) continue;
      if (!requiresMarketQuoteForAsset(valuationSnapshot, assetType, ticker)) continue;
      if (!this.requiresExactDailyQuote(assetType, ticker)) continue;
      const type = String(e.transaction_type ?? '');
      const qty = Math.abs(Number(e.quantity ?? 0));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const current = qtyByTicker.get(ticker) ?? 0;
      if (type === 'sell' || type === 'option_exercise') {
        qtyByTicker.set(ticker, current - qty);
      } else if (type === 'put_sell' || type === 'call_sell') {
        qtyByTicker.set(ticker, current - qty);
      } else if (type === 'put_buy' || type === 'call_buy') {
        qtyByTicker.set(ticker, current + qty);
      } else if (type === 'opening_balance') {
        qtyByTicker.set(ticker, current + Math.abs(Number(e.quantity ?? 0)));
      } else {
        qtyByTicker.set(ticker, current + qty);
      }
    }
    return [...qtyByTicker.entries()]
      .filter(([, qty]) => Math.abs(qty) > 0.0001)
      .map(([ticker]) => ticker)
      .sort();
  }

  private async assertRequiredQuotesForBusinessDay(
    ctx: UserContext,
    quoteMap: Map<string, Map<string, number>>,
    events: Array<Record<string, unknown>>,
    date: string
  ): Promise<void> {
    if (this.isWeekend(date)) return;
    const openQuotedAssets = await this.quotedTickersOpenOnDate(ctx, events, date);
    const missing = openQuotedAssets.filter((ticker) => {
      const exact = quoteMap.get(ticker)?.get(date);
      return !(exact != null && Number.isFinite(exact) && exact > 0);
    });
    if (missing.length) {
      throw new Error(
        `Cotacao diaria obrigatoria ausente em ${date}: ${missing.join(', ')}. ` +
          'Busque via fonte de cotacao configurada antes de gravar patrimonio.'
      );
    }
  }

  async loadStockQuotes(ctx: UserContext, asOf?: string): Promise<{
    quotes: Record<string, number>;
    quotesAsOf: string | null;
  }> {
    if (!ctx.organizationId) return { quotes: {}, quotesAsOf: null };
    const targetDate = (asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const assets = await this.assetProjection.listActiveAssets(ctx);
    const valuationSnapshot = await this.valuationContext.load(ctx);

    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type || inferAssetType(ticker));
      if (!requiresMarketQuoteForAsset(valuationSnapshot, type, ticker)) continue;
      tickers.push(ticker);
    }

    const quotes: Record<string, number> = {};
    let quotesAsOf: string | null = null;

    const marketMap = await this.marketQuotes.loadLatestQuoteMap(ctx, tickers, targetDate);

    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker) continue;

      const mq = marketMap.get(ticker);
      if (mq && Number.isFinite(mq.price) && mq.price > 0) {
        quotes[ticker] = mq.price;
        if (!quotesAsOf || mq.date > quotesAsOf) quotesAsOf = mq.date;
        continue;
      }

      const assetType = String(row.asset_type || inferAssetType(ticker));
      if (requiresMarketQuoteForAsset(valuationSnapshot, assetType, ticker)) {
        continue;
      }
      if (!isOptionTicker(ticker)) {
        continue;
      }

      let meta: { last_price?: number; quote_as_of?: string } = {};
      if (row.metadata) {
        try {
          meta = typeof row.metadata === 'string'
            ? JSON.parse(row.metadata)
            : (row.metadata as { last_price?: number; quote_as_of?: string });
        } catch { meta = {}; }
      }
      const lp = Number(meta.last_price ?? row.managerial_avg_price ?? 0);
      if (Number.isFinite(lp) && lp >= 0) quotes[ticker] = lp;
      if (meta.quote_as_of) {
        const qd = String(meta.quote_as_of).slice(0, 10);
        if (!quotesAsOf || qd > quotesAsOf) quotesAsOf = qd;
      }
    }

    void targetDate;
    return { quotes, quotesAsOf };
  }

  /**
   * Grava fechamento diário: patrimônio principal alinhado à custódia BTG quando há âncoras;
   * mantém série econômica em metadata para auditoria e evolução futura.
   */
  async recordDay(
    ctx: UserContext,
    snapshotDate?: string,
    opts?: { economicOnly?: boolean }
  ): Promise<RecordDailyPatrimonyResult> {
    const date = (snapshotDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const anchors = await this.anchorsRepo.loadForOrganization(ctx);
    const hasAnchors = anchors.month_ends.length > 0;

    const period = await this.resolvePeriodOrNull(ctx);
    const events = await this.ledger.listLedgerEvents(
      ctx,
      period?.openingDate ?? '2020-01-01',
      date
    );
    const bounds = resolveInvestPeriodBounds(events, {
      openingDate: period?.openingDate ?? null,
    });
    const ledgerFrom = bounds.periodMin || date;

    const quoteMap = await this.marketQuotes.loadQuoteMapForRange(ctx, ledgerFrom, date);
    await this.assertRequiredQuotesForBusinessDay(
      ctx,
      quoteMap,
      events as unknown as Array<Record<string, unknown>>,
      date
    );
    const quoteForDate =
      quoteMap.size > 0 ? this.marketQuotes.buildQuoteForDateFn(quoteMap) : undefined;
    const { quotes: stockQuotesLatest, quotesAsOf } = await this.loadStockQuotes(ctx, date);
    const stockQuotes =
      quoteForDate != null
        ? {}
        : stockQuotesLatest;

    const rfLedger = fixedIncomeTotalFromLedger(events);
    const rfAnchor = Number(anchors.fixed_income_total ?? 0);
    const rfForEconomic = rfLedger;

    const useCalibration =
      !opts?.economicOnly && hasAnchors && (await shouldUseBtgAnchorCalibration(ctx, events, this.policyService));
    const valuationSnapshot = await this.valuationContext.load(ctx);
    const optionCatalog = ctx.organizationId
      ? await loadOptionMarketCatalog(this.gateway, ctx.organizationId)
      : new Map();
    const fxByPair = new Map<string, number>();
    const foreignCurrencies = new Set(
      [...valuationSnapshot.currencyByType.values()].filter((currency) => currency !== 'BRL')
    );
    for (const currency of foreignCurrencies) {
      const rate = await this.fxRates.getClosingRate(currency, 'BRL', date).catch(() => null);
      if (rate != null && Number.isFinite(rate) && rate > 0) {
        fxByPair.set(`${currency}/BRL`, rate);
      }
    }

    const mtmOpts = {
      anchors,
      stockQuotes,
      fixedIncomeTotal: rfForEconomic,
      calibrateToAnchors: useCalibration,
      quoteForDate,
      valuationContext: valuationSnapshot,
      optionContractForTicker: (ticker: string) => {
        const row = optionCatalog.get(ticker.toUpperCase());
        return row
          ? {
              underlyingTicker: row.underlyingTicker,
              optionType: row.optionType,
              strikePrice: row.strikePrice,
              expirationDate: row.expirationDate,
            }
          : undefined;
      },
      fxRateForDate: (fromCurrency: string, toCurrency: string) =>
        fxByPair.get(`${fromCurrency.toUpperCase()}/${toCurrency.toUpperCase()}`),
    };

    const mtm = buildDailyPatrimonyMtmSeries(events, ledgerFrom, date, mtmOpts);
    const recordPoint = mtm.series[mtm.series.length - 1];
    if (!recordPoint || recordPoint.date !== date) {
      throw new Error(`Sem patrimônio econômico calculado para ${date}.`);
    }

    let economicMtm = mtm;
    let economicPoint = recordPoint;
    if (useCalibration) {
      economicMtm = buildDailyPatrimonyMtmSeries(events, ledgerFrom, date, {
        ...mtmOpts,
        calibrateToAnchors: false,
      });
      economicPoint = economicMtm.series[economicMtm.series.length - 1] ?? recordPoint;
    }

    const source = useCalibration ? 'mtm_btg_calibrated' : 'mtm_economic';
    const btgPatrimony = useCalibration
      ? Math.round(interpolatePatrimonyTarget(date, anchors) * 100) / 100
      : null;

    const patrimonyGross = recordPoint.patrimonyGross;

    const flowsByDate = aggregateExternalFlowsByDate(events, date, date);
    const externalFlow = flowsByDate.get(date) ?? 0;

    const prev = await this.store.loadDayBefore(ctx, date);
    let dailyReturnTwr: number | null = null;
    let cumulativeTwr: number | null = null;

    if (prev && prev.patrimony > 0) {
      dailyReturnTwr =
        Math.round(((recordPoint.patrimony - prev.patrimony - externalFlow) / prev.patrimony) * 10000) /
        10000;
      const prevCum = prev.cumulative_twr ?? 0;
      cumulativeTwr =
        dailyReturnTwr != null
          ? Math.round(((1 + prevCum) * (1 + dailyReturnTwr) - 1) * 10000) / 10000
          : prevCum;
    } else {
      dailyReturnTwr = 0;
      cumulativeTwr = 0;
    }

    const positions = (useCalibration ? economicMtm.positionSnapshots : mtm.positionSnapshots) ?? [];
    const fixedIncomePositions = positions.filter(
      (p) => String(p.assetType) === 'fixed_income'
    );
    const markedFixedIncomeTotal =
      fixedIncomePositions.length > 0
        ? Math.round(
            fixedIncomePositions.reduce((sum, p) => sum + Number(p.marketValue ?? 0), 0) * 100
          ) / 100
        : rfForEconomic;
    const recorded = await this.store.upsertPortfolioDay(ctx, {
      snapshotDate: date,
      point: recordPoint,
      validationPoint: economicPoint,
      patrimonyGross,
      fixedIncomeTotal: markedFixedIncomeTotal,
      externalFlow,
      dailyReturnTwr,
      cumulativeTwr,
      quotesAsOf,
      positionSnapshots: positions,
      stockQuotes,
      source,
      metadataExtra: {
        economic_patrimony: economicPoint.patrimony,
        economic_patrimony_gross: economicPoint.patrimonyGross,
        btg_interpolated_patrimony: btgPatrimony,
        cash: economicPoint.cash,
        positions_value: economicPoint.positionsValue,
        pending_settlements: economicPoint.pendingSettlements,
        rf_ledger: rfLedger,
        rf_anchor: rfAnchor,
        rf_marked: markedFixedIncomeTotal,
        rf_anchor_delta: Math.round((markedFixedIncomeTotal - rfAnchor) * 100) / 100,
      },
    });

    return {
      snapshotDate: date,
      recorded,
      positionsSaved: positions.length,
      quotesAsOf,
      economicPatrimony: economicPoint.patrimony,
      btgPatrimony,
    };
  }

  private async resolvePeriodOrNull(ctx: UserContext) {
    try {
      return await this.periods.resolveDefault(ctx);
    } catch (err) {
      if (err instanceof GatewayError && err.code === 'INVEST_BOOK_PERIOD_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }
}
