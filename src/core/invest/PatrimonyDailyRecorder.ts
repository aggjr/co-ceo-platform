import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { LedgerImportService } from './LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from './PatrimonyMtmDailyEngine';
import { interpolatePatrimonyTarget } from './patrimonyAnchors';
import { PatrimonyMonthlyAnchorsRepository } from './PatrimonyMonthlyAnchorsRepository';
import { fixedIncomeTotalFromLedger, shouldUseBtgAnchorCalibration } from './patrimonyLedgerGates';
import { resolveInvestPeriodBounds } from './investPeriodBounds';
import { PatrimonyDailyStore, type StoredPortfolioDay } from './PatrimonyDailyStore';
import { aggregateExternalFlowsByDate } from './portfolioPerformance';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';

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

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.store = new PatrimonyDailyStore(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
    this.anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  }

  async loadStockQuotes(ctx: UserContext, asOf?: string): Promise<{
    quotes: Record<string, number>;
    quotesAsOf: string | null;
  }> {
    if (!ctx.organizationId) return { quotes: {}, quotesAsOf: null };
    const targetDate = (asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const assets = await this.assetProjection.listActiveAssets(ctx);

    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type ?? '');
      if (type === 'fixed_income' || ticker.startsWith('TESOURO-') ||
          ticker.startsWith('CDB-') || ticker.startsWith('LFT-') || ticker.startsWith('TD-')) continue;
      tickers.push(ticker);
    }

    const quotes: Record<string, number> = {};
    let quotesAsOf: string | null = null;

    const marketMap = await this.marketQuotes.loadLatestQuoteMap(ctx, tickers);

    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker) continue;

      const mq = marketMap.get(ticker);
      if (mq && Number.isFinite(mq.price) && mq.price > 0) {
        quotes[ticker] = mq.price;
        if (!quotesAsOf || mq.date > quotesAsOf) quotesAsOf = mq.date;
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

    const events = await this.ledger.listLedgerEvents(ctx, '2020-01-01', date);
    const bounds = resolveInvestPeriodBounds(events);
    const ledgerFrom = bounds.periodMin || date;

    const quoteMap = await this.marketQuotes.loadQuoteMapForRange(ctx, ledgerFrom, date);
    const quoteForDate =
      quoteMap.size > 0 ? this.marketQuotes.buildQuoteForDateFn(quoteMap) : undefined;
    const { quotes: stockQuotesLatest, quotesAsOf } = await this.loadStockQuotes(ctx, date);
    const stockQuotes =
      quoteForDate != null
        ? {}
        : stockQuotesLatest;

    const rfLedger = fixedIncomeTotalFromLedger(events);
    const rfAnchor = Number(anchors.fixed_income_total ?? 0);
    const rfForEconomic = hasAnchors && rfAnchor > 0 ? rfAnchor : rfLedger;

    const economicMtm = buildDailyPatrimonyMtmSeries(events, ledgerFrom, date, {
      anchors,
      stockQuotes,
      fixedIncomeTotal: rfForEconomic,
      calibrateToAnchors: false,
      quoteForDate,
    });

    const economicPoint = economicMtm.series[economicMtm.series.length - 1];
    if (!economicPoint || economicPoint.date !== date) {
      throw new Error(`Sem patrimônio econômico calculado para ${date}.`);
    }

    let recordPoint = economicPoint;
    let source = 'mtm_economic';
    let btgPatrimony: number | null = null;

    if (!opts?.economicOnly && hasAnchors && shouldUseBtgAnchorCalibration(events)) {
      btgPatrimony = Math.round(interpolatePatrimonyTarget(date, anchors) * 100) / 100;
      const pending = economicPoint.pendingSettlements;
      recordPoint = {
        ...economicPoint,
        patrimony: btgPatrimony,
        patrimonyGross: Math.round((btgPatrimony - pending) * 100) / 100,
        positionsValue: economicPoint.positionsValue,
      };
      source = 'mtm_btg_calibrated';
    }

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

    const positions = economicMtm.positionSnapshots ?? [];
    const recorded = await this.store.upsertPortfolioDay(ctx, {
      snapshotDate: date,
      point: recordPoint,
      patrimonyGross,
      fixedIncomeTotal: rfForEconomic,
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
}
