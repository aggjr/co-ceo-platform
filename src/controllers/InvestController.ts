import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { FieldPolicyService } from '../core/auth/FieldPolicyService';
import { CoCeoDataGateway } from '../core/dal';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { PIVOT_COLUMN_LABELS } from '../core/invest/ledgerTypes';
import { buildPnLPivot } from '../core/invest/PnLPivotEngine';
import {
  buildStockUnderlyingPivot,
  enrichStockPivotWithQuotes,
  STOCK_PIVOT_COLUMN_LABELS,
  STOCK_PIVOT_COLUMNS,
} from '../core/invest/StockUnderlyingPivotEngine';
import { buildDailyPatrimonySeries } from '../core/invest/PatrimonyDailyEngine';
import { buildBtgAnchorPatrimonyDailyResult } from '../core/invest/btgPatrimonySeries';
import { buildDailyPatrimonyMtmSeries } from '../core/invest/PatrimonyMtmDailyEngine';
import { buildBrokerageNoteReviewRows } from '../core/invest/brokerageNotesReviewFromLedger';
import { buildExtractReconciliationSummary } from '../core/invest/btgExtractCashSeries';
import { compareToBtgPublished } from '../core/invest/btgPerformanceReference';
import { PatrimonyMonthlyAnchorsRepository } from '../core/invest/PatrimonyMonthlyAnchorsRepository';
import { fixedIncomeTotalFromLedger } from '../core/invest/patrimonyLedgerGates';
import { InvestQuoteSyncService } from '../core/invest/InvestQuoteSyncService';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';
import { fetchB3Quotes } from '../core/invest/B3QuoteProvider';
import { fetchOpcoesNetOptionQuotes } from '../core/invest/opcoesNetQuotes';
import { authBootstrapContext } from '../core/auth/authBootstrapContext';
import { MarketQuoteRepository } from '../core/market/MarketQuoteRepository';
import {
  buildCdiBenchmarkForChart,
  buildStockBenchmarkForChart,
} from '../core/market/indexBenchmark';
import {
  buildStoredTwrChartSeries,
  resolvePortfolioIndexedForChart,
} from '../core/invest/storedPatrimonyChart';

import { resolveInvestPeriodBounds } from '../core/invest/investPeriodBounds';
import { InvestAssetProjection } from '../modules/invest/sync/InvestAssetProjection';
import {
  filterStoredDaysForChartMethod,
  mergeStoredPatrimonySeries,
  trimZeroPatrimonyTailAfterLastStored,
  PatrimonyDailyStore,
} from '../core/invest/PatrimonyDailyStore';
import {
  computePortfolioPerformance,
  listExternalFlows,
} from '../core/invest/portfolioPerformance';
import {
  attachCallCoverageToEquities,
  buildShortCallPremiumPendingByUnderlying,
  collectCallCoverageOptionRows,
} from '../core/invest/callCoverage';
import { rebuildCustodyFromLedger } from '../core/invest/CustodyEngine';
import {
  inferUnderlyingTicker,
  isFixedIncomeTicker,
  isOptionTicker,
} from '../core/invest/assetClassifier';
import { resolveCashInvestDisplayBalance } from '../core/invest/cashInvestLedger';
import { buildCashInTransitSummary } from '../core/invest/cashInTransit';
import { loadOptionMarketCatalog } from '../core/invest/optionMarketCatalog';
import { buildOptionStrikeMapFromLedgerEvents } from '../core/invest/optionStrikeFromLedger';
import {
  applyAllocationPercents,
  applyCashInvestBalanceToItems,
  enrichPortfolioRow,
  attachUnderlyingMarketData,
  buildLongEquityPmMapFromAssetRows,
  consolidateTesouroPortfolioItems,
  mergeLedgerCustodyIntoAssetRows,
  mergeOptionStrikeIntoAssetRow,
  partitionPortfolioPositions,
  summarizePortfolio,
} from '../core/invest/portfolioMapper';
import {
  buildThreeAvgPricesByUnderlying,
  resolveThreePricesForAsset,
} from '../core/invest/portfolioThreePrices';
import { computeThreePricesByUnderlying } from '../core/invest/threePricesEngine';
import { validateEquityThreePrices } from '../core/invest/threePricesValidation';
import {
  buildCostAdjustmentIndex,
  buildNotesTradeSummary,
  inferFromCashDescription,
  isDuplicateManualOpeningCash,
  normalizeBrokerNoteRef,
} from '../core/invest/extractLedgerEnrichment';
import type { LedgerImportPayload } from '../core/invest/ledgerTypes';
import type { UserContext } from '../core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../core/dal/types';
import pool from '../config/database';
import { isMissingSchemaError } from '../core/dal/mysqlErrors';
import { seedMarketBenchmarks } from '../core/market/MarketBenchmarkSeeder';
import { StockMarketSyncService } from '../core/market/StockMarketSyncService';

function portfolioRowMatchesAssetClass(
  row: Record<string, unknown>,
  assetClass: string
): boolean {
  const type = String(row.asset_type ?? '').toLowerCase();
  const t = String(row.asset_ticker ?? '').trim().toUpperCase();
  const isOpt =
    type === 'option_call' || type === 'option_put' || isOptionTicker(t);
  const isFi =
    type === 'fixed_income' || type === 'cdb' || isFixedIncomeTicker(t);
  const isCash = type === 'cash' || t.startsWith('CAIXA-');
  if (assetClass === 'options') return isOpt;
  if (assetClass === 'fixedIncome') return isFi || isCash;
  if (assetClass === 'equities') return !isOpt && !isFi && !isCash;
  return true;
}

export class InvestController {
  private readonly ledger: LedgerImportService;
  private readonly patrimonyStore: PatrimonyDailyStore;
  private readonly patrimonyRecorder: PatrimonyDailyRecorder;
  private readonly quoteSync: InvestQuoteSyncService;
  private readonly assetProjection: InvestAssetProjection;
  private readonly marketQuoteRepo: MarketQuoteRepository;
  private readonly patrimonyAnchorsRepo: PatrimonyMonthlyAnchorsRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyStore = new PatrimonyDailyStore(gateway);
    this.patrimonyRecorder = new PatrimonyDailyRecorder(gateway);
    this.quoteSync = new InvestQuoteSyncService(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
    this.marketQuoteRepo = new MarketQuoteRepository(gateway);
    this.patrimonyAnchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  }

  private async periodBoundsFor(ctx: UserContext) {
    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    return resolveInvestPeriodBounds(events);
  }

  getInvestUiContext = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }
    const context = await this.periodBoundsFor(ctx);
    return res.json({ success: true, context });
  };

  listPortfolio = async (req: Request, res: Response) => {
    try {
      return await this.listPortfolioImpl(req, res);
    } catch (err) {
      console.error('[listPortfolio]', err);
      if (isMissingSchemaError(err)) {
        return res.status(503).json({
          success: false,
          error:
            'Banco desatualizado: aplique a migration 22 (market_quotes_daily) ou reinicie a API em V0.0.87+.',
        });
      }
      const message = err instanceof Error ? err.message : 'Falha ao carregar portfólio.';
      return res.status(500).json({ success: false, error: message });
    }
  };

  private listPortfolioImpl = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error:
          'Selecione uma organização para ver o portfólio (ex.: personifique o titular da holding).',
      });
    }

    const assetClassQuery = req.query.assetClass as string | undefined;
    const optionsOnly = assetClassQuery === 'options';

    const rows = await this.assetProjection.listActiveAssets(ctx);

    const today = new Date().toISOString().slice(0, 10);
    const ledgerEvents = await this.ledger.listLedgerEvents(
      ctx,
      '2000-01-01',
      today
    );
    const { assets: ledgerCustody } = rebuildCustodyFromLedger(ledgerEvents);
    const allMerged = mergeLedgerCustodyIntoAssetRows(
      rows as Record<string, unknown>[],
      ledgerCustody
    );
    const equityPmByUnderlying = buildLongEquityPmMapFromAssetRows(allMerged);
    let rowsMerged = allMerged;
    if (assetClassQuery) {
      rowsMerged = allMerged.filter((r) =>
        portfolioRowMatchesAssetClass(r, assetClassQuery)
      );
    }

    const threeByUnderlying = optionsOnly
      ? new Map<string, { strict: number; b3: number; managerial: number }>()
      : buildThreeAvgPricesByUnderlying(ledgerEvents);
    const engineSnapshots = optionsOnly
      ? new Map()
      : computeThreePricesByUnderlying(ledgerEvents);
    const ledgerStrikeByTicker = buildOptionStrikeMapFromLedgerEvents(ledgerEvents);
    const marketCatalog = await loadOptionMarketCatalog(
      this.gateway,
      ctx.organizationId!
    );
    const strikeHints = { ledgerStrikeByTicker, marketCatalog };

    const quoteTickers = new Set<string>();
    for (const r of rowsMerged) {
      const t = String(r.asset_ticker ?? '').trim().toUpperCase();
      if (!t || t.startsWith('CAIXA-')) continue;
      const type = String(r.asset_type ?? '').toLowerCase();
      if (type === 'stock' || type === 'fii') {
        quoteTickers.add(t);
        continue;
      }
      if (type === 'option_call' || type === 'option_put' || isOptionTicker(t)) {
        quoteTickers.add(t);
        const und = inferUnderlyingTicker(t);
        if (und) quoteTickers.add(und);
      }
    }
    const allQuoteTickers = [...quoteTickers];
    const marketQuoteMap = await this.marketQuoteRepo.loadLatestQuoteMap(
      ctx,
      allQuoteTickers
    );
    const missingQuotes = allQuoteTickers.filter((t) => !marketQuoteMap.has(t));
    const missingEquity = missingQuotes.filter((t) => !isOptionTicker(t));
    const missingOptions = missingQuotes.filter((t) => isOptionTicker(t));

    if (missingEquity.length) {
      try {
        const quotes = await fetchB3Quotes(missingEquity, {
          token: process.env.BRAPI_TOKEN,
        });
        const marketCtx = authBootstrapContext();
        for (const q of quotes) {
          await this.marketQuoteRepo.upsertQuote(marketCtx, {
            ticker: q.ticker,
            quoteDate: q.asOf,
            closingPrice: q.price,
            source: 'brapi',
            metadata: { kind: q.kind },
          });
          marketQuoteMap.set(q.ticker.toUpperCase(), {
            price: q.price,
            date: q.asOf,
          });
        }
      } catch (err) {
        console.warn('[listPortfolio] preenchimento brapi de cotações:', err);
      }
    }

    // Tela de opções: só cotações já no banco (sync manual/cron). Evita grade opcoes.net no request.
    if (missingOptions.length && !optionsOnly) {
      try {
        const optQuotes = await fetchOpcoesNetOptionQuotes(missingOptions);
        const marketCtx = authBootstrapContext();
        for (const q of optQuotes) {
          await this.marketQuoteRepo.upsertQuote(marketCtx, {
            ticker: q.ticker,
            quoteDate: q.asOf,
            closingPrice: q.price,
            source: 'opcoes_net',
            metadata: { kind: 'option_last' },
          });
          marketQuoteMap.set(q.ticker.toUpperCase(), {
            price: q.price,
            date: q.asOf,
          });
        }
      } catch (err) {
        console.warn('[listPortfolio] preenchimento opcoes.net de opções:', err);
      }
    }

    const items = [];
    for (const raw of rowsMerged) {
      const row = mergeOptionStrikeIntoAssetRow(
        raw,
        ledgerStrikeByTicker,
        marketCatalog
      );
      const filtered = await FieldPolicyService.filterRowForRead(
        ctx.roleId,
        ctx.organizationId,
        'patrimony_items',
        row
      );
      const meta =
        typeof filtered.metadata === 'string'
          ? (() => {
              try {
                return JSON.parse(filtered.metadata) as { underlying_ticker?: string };
              } catch {
                return {};
              }
            })()
          : (filtered.metadata as { underlying_ticker?: string }) || {};
      const three = resolveThreePricesForAsset(
        String(filtered.asset_ticker ?? ''),
        String(filtered.asset_type ?? ''),
        meta.underlying_ticker,
        threeByUnderlying,
        Number(filtered.managerial_avg_price ?? 0)
      );
      const ticker = String(filtered.asset_ticker ?? '').toUpperCase();
      const mq = marketQuoteMap.get(ticker);
      const marketQuote = mq
        ? { price: mq.price, asOf: mq.date }
        : null;
      const item = enrichPortfolioRow(filtered, three, strikeHints, marketQuote);
      const assetType = String(item.assetType ?? '');
      if (
        (assetType === 'stock' || assetType === 'fii') &&
        Math.abs(item.quantity) > 1e-6
      ) {
        const und = String(
          meta.underlying_ticker || ticker
        ).toUpperCase();
        item.threePricesValidation = validateEquityThreePrices({
          ticker,
          custodyQty: Number(filtered.current_quantity ?? 0),
          engineSnapshot: engineSnapshots.get(und) ?? engineSnapshots.get(ticker) ?? null,
          storedExt: {
            strict:
              filtered.pm_estrito != null ? Number(filtered.pm_estrito) : null,
            b3: filtered.pm_b3 != null ? Number(filtered.pm_b3) : null,
            managerial:
              filtered.pm_gerencial != null ? Number(filtered.pm_gerencial) : null,
          },
          displayed: three,
        });
      }
      items.push(item);
    }

    const underlyingSpots = new Map<string, number>();
    for (const [ticker, mq] of marketQuoteMap) {
      const price = Number(mq.price);
      if (price > 0) underlyingSpots.set(ticker.toUpperCase(), price);
    }
    const withUnderlyingQuotes = attachUnderlyingMarketData(
      items,
      underlyingSpots,
      equityPmByUnderlying
    );
    withUnderlyingQuotes.sort((a, b) => b.marketValue - a.marketValue);
    const { open, closedOptions } = partitionPortfolioPositions(withUnderlyingQuotes);
    const consolidated = optionsOnly
      ? open
      : consolidateTesouroPortfolioItems(open);
    const withAllocation = applyAllocationPercents(consolidated);

    let responseItems = withAllocation;
    let cashInTransit: ReturnType<typeof buildCashInTransitSummary> | null = null;

    if (optionsOnly) {
      cashInTransit = {
        asOfDate: today,
        settledCashBalance: 0,
        inTransitNet: 0,
        receivables: 0,
        payables: 0,
        cashIncludingTransit: 0,
        lines: [],
      };
    } else {
      const coverageOptions = collectCallCoverageOptionRows(
        withAllocation,
        ledgerCustody
      );
      const premiumByUnderlying =
        buildShortCallPremiumPendingByUnderlying(ledgerEvents);
      responseItems = attachCallCoverageToEquities(
        withAllocation,
        coverageOptions,
        premiumByUnderlying
      );
      cashInTransit = buildCashInTransitSummary(ledgerEvents, today);
      responseItems = applyCashInvestBalanceToItems(
        responseItems,
        cashInTransit.settledCashBalance
      );
    }

    const threePricesAudit = { ok: 0, warn: 0, error: 0, pending: [] as Array<{
      ticker: string;
      status: string;
      observation: string;
    }> };
    if (!optionsOnly) {
      for (const it of responseItems) {
        const v = it.threePricesValidation;
        if (!v) continue;
        if (v.status === 'ok') threePricesAudit.ok += 1;
        else if (v.status === 'warn') threePricesAudit.warn += 1;
        else threePricesAudit.error += 1;
        if (v.status !== 'ok') {
          threePricesAudit.pending.push({
            ticker: it.ticker,
            status: v.status,
            observation: v.observation,
          });
        }
      }
    }

    return res.json({
      success: true,
      items: responseItems,
      closedOptions,
      summary: summarizePortfolio(responseItems),
      cashStatementBalance: cashInTransit!.settledCashBalance,
      cashInTransit,
      threePricesAudit,
      source: 'custody',
    });
  };

  getOptionStrikeLadder = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }
    const underlying = String(req.query.underlying ?? '').trim().toUpperCase();
    const expiry = String(req.query.expiry ?? '').trim().slice(0, 10);
    if (!underlying || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      return res.status(400).json({
        success: false,
        error: 'Informe underlying e expiry (YYYY-MM-DD).',
      });
    }
    try {
      const globalCtx: UserContext = {
        userId: SYSTEM_INSTALLER_USER_ID,
        organizationId: null,
        impersonatorId: null,
        scope: 'global',
      };
      const rows = await this.gateway.readQuery(
        globalCtx,
        'invest_options_market_strikes',
        [underlying, expiry]
      );
      const strikes = rows
        .map((r) => Number(r.strike_price))
        .filter((s) => Number.isFinite(s) && s > 0);
      const quoteMap = await this.marketQuoteRepo.loadLatestQuoteMap(ctx, [underlying]);
      const mq = quoteMap.get(underlying);
      return res.json({
        success: true,
        underlying,
        expiry,
        strikes,
        quote: mq?.price ?? null,
        quoteAsOf: mq?.date ?? null,
      });
    } catch (err) {
      console.error('[getOptionStrikeLadder]', err);
      if (isMissingSchemaError(err)) {
        return res.status(503).json({
          success: false,
          error: 'Banco desatualizado: tabela invest_options_market ausente.',
        });
      }
      const message =
        err instanceof Error ? err.message : 'Falha ao carregar grade de strikes.';
      return res.status(500).json({ success: false, error: message });
    }
  };

  getPatrimonyDaily = async (req: Request, res: Response) => {
    try {
      return await this.getPatrimonyDailyImpl(req, res);
    } catch (err) {
      console.error('[getPatrimonyDaily]', err);
      if (isMissingSchemaError(err)) {
        return res.status(503).json({
          success: false,
          error:
            'Banco desatualizado: aplique as migrations 09 (invest_portfolio_daily) e 22 (market_quotes_daily) no servidor.',
        });
      }
      const message =
        err instanceof Error ? err.message : 'Falha ao calcular patrimônio diário.';
      return res.status(500).json({ success: false, error: message });
    }
  };

  private getPatrimonyDailyImpl = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }

    const bounds = await this.periodBoundsFor(ctx);
    const today = bounds.today;
    const fromQ = String(req.query.from || bounds.defaultFrom).slice(0, 10);
    const from = fromQ < bounds.periodMin ? bounds.periodMin : fromQ;
    const toRaw = String(req.query.to || today).slice(0, 10);
    const to = toRaw > today ? today : toRaw;
    const riskFreeAnnual = Number(req.query.risk_free ?? 0);

    const events = await this.ledger.listLedgerEvents(ctx, from, to);
    const method = String(req.query.method || 'mtm_btg').toLowerCase();

    // Cotações estáticas por cliente (invest_position_ext) — usadas como fallback e para
    // o snapshot do dia mais recente quando market_quotes_daily ainda não foi populado.
    let stockQuotes: Record<string, number> | undefined;
    if (method === 'mtm_btg') {
      const assets = await this.assetProjection.listActiveAssets(ctx);
      stockQuotes = {};
      for (const row of assets) {
        const ticker = String(row.asset_ticker ?? '').toUpperCase();
        let meta: { last_price?: number } = {};
        if (row.metadata) {
          try {
            meta =
              typeof row.metadata === 'string'
                ? JSON.parse(row.metadata)
                : (row.metadata as { last_price?: number });
          } catch {
            meta = {};
          }
        }
        const lp = Number(meta.last_price ?? row.managerial_avg_price ?? 0);
        if (Number.isFinite(lp) && lp >= 0) stockQuotes[ticker] = lp;
      }
    }

    // Cotações históricas de market_quotes_daily — 1 query bulk para o range inteiro.
    // O engine usa quoteForDate(ticker, date) por dia; cai em stockQuotes se não encontrar.
    const quoteMap = await this.marketQuoteRepo.loadQuoteMapForRange(ctx, from, to);
    let marketQuoteRows = 0;
    for (const byDate of quoteMap.values()) marketQuoteRows += byDate.size;
    const quoteForDate =
      quoteMap.size > 0
        ? this.marketQuoteRepo.buildQuoteForDateFn(quoteMap)
        : undefined;

    const anchors = await this.patrimonyAnchorsRepo.loadForOrganization(ctx);
    const useBtgAnchorCurve = method === 'mtm_btg' && anchors.month_ends.length > 0;
    const calibrateToAnchors = useBtgAnchorCurve;
    const fixedIncomeTotal = calibrateToAnchors
      ? Number(anchors.fixed_income_total ?? 0)
      : fixedIncomeTotalFromLedger(events);

    const riskFree = Number.isFinite(riskFreeAnnual) ? riskFreeAnnual : 0;
    let result =
      method === 'ledger_replay'
        ? buildDailyPatrimonySeries(events, from, to, { riskFreeAnnual: riskFree })
        : useBtgAnchorCurve
          ? buildBtgAnchorPatrimonyDailyResult(events, from, to, anchors, riskFree)
          : buildDailyPatrimonyMtmSeries(events, from, to, {
              riskFreeAnnual: riskFree,
              anchors,
              stockQuotes,
              fixedIncomeTotal,
              calibrateToAnchors: false,
              quoteForDate,
            });

    const storedDaysRaw = await this.patrimonyStore.loadRange(ctx, from, to);
    const storedDays = filterStoredDaysForChartMethod(storedDaysRaw, method);
    let storedDates: string[] = [];
    if (storedDays.length > 0) {
      const merged = mergeStoredPatrimonySeries(result.series, storedDays);
      const series = trimZeroPatrimonyTailAfterLastStored(merged.series, storedDays);
      storedDates = merged.storedDates.filter((d) => series.some((p) => p.date === d));
      result = { ...result, series };
    }

    const performanceOnSeries = computePortfolioPerformance(result.series, events, from, to);
    if (performanceOnSeries) {
      const anchorExtras = result.performance
        ? {
            monthAnchorTwr: result.performance.monthAnchorTwr,
            monthAnchorBreakdown: result.performance.monthAnchorBreakdown,
            periodReturnTwrDaily: result.performance.periodReturnTwrDaily,
          }
        : {};
      result = {
        ...result,
        performance: { ...performanceOnSeries, ...anchorExtras },
      };
    }

    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);
    const btgReference =
      result.performance != null
        ? compareToBtgPublished(
            result.performance.periodReturnTwr,
            fromMonth,
            toMonth
          )
        : null;

    const extractReconciliation = buildExtractReconciliationSummary();
    const ledgerFlows = listExternalFlows(events, from, to);
    const tedsMatched =
      extractReconciliation.tedsInExtract.length === 0 ||
      extractReconciliation.tedsInExtract.every((et) =>
        ledgerFlows.some((f) => f.date === et.date && Math.abs(f.amount - et.amount) < 0.02)
      );

    const cashInTransit = buildCashInTransitSummary(events, to);

    const chartDates = result.series.map((p) => String(p.date).slice(0, 10));
    let cdiRows = await this.marketQuoteRepo.loadIndexRange(ctx, 'CDI', from, to);
    const chartStock = bounds.chartBenchmarkTicker;
    let prioQuotes: Awaited<ReturnType<MarketQuoteRepository['loadQuoteRange']>> = [];
    if (chartStock) {
      prioQuotes = await this.marketQuoteRepo.loadQuoteRange(ctx, chartStock, from, to);
      if (!cdiRows.length || !prioQuotes.length) {
        try {
          await seedMarketBenchmarks(this.gateway, pool, {
            from,
            to,
            stockTicker: chartStock,
          });
          cdiRows = await this.marketQuoteRepo.loadIndexRange(ctx, 'CDI', from, to);
          prioQuotes = await this.marketQuoteRepo.loadQuoteRange(ctx, chartStock, from, to);
        } catch {
          /* seed best-effort */
        }
      }
    }
    const cdiBenchmark = buildCdiBenchmarkForChart(cdiRows, from, to, chartDates);
    const stockBenchmark = chartStock
      ? buildStockBenchmarkForChart(
          prioQuotes.map((q) => ({ quote_date: q.quote_date, closing_price: q.closing_price })),
          chartDates,
          chartStock
        )
      : buildStockBenchmarkForChart([], chartDates, '');
    const storedTwrChart =
      storedDays.filter((s) => s.cumulative_twr != null).length >= 2
        ? buildStoredTwrChartSeries(storedDays, chartDates, from)
        : [];
    const portfolioIndexed = resolvePortfolioIndexedForChart(
      result.series,
      result.performance?.points ?? null,
      storedTwrChart
    );
    const portfolioPeriodReturn =
      result.performance?.periodReturnTwr ??
      (portfolioIndexed.length >= 2
        ? portfolioIndexed[portfolioIndexed.length - 1]!.periodReturnToDate
        : null);
    const cdiComparison =
      cdiBenchmark.available &&
      cdiBenchmark.periodReturn != null &&
      portfolioPeriodReturn != null
        ? {
            portfolioPeriodReturn,
            cdiPeriodReturn: cdiBenchmark.periodReturn,
            excessReturn:
              Math.round((portfolioPeriodReturn - cdiBenchmark.periodReturn) * 1_000_000) /
              1_000_000,
          }
        : null;

    return res.json({
      success: true,
      ...result,
      cdiBenchmark,
      stockBenchmark,
      chartBenchmarkTicker: chartStock,
      periodBounds: bounds,
      portfolioIndexed,
      cdiComparison,
      cashInTransit,
      btgReference,
      extractReconciliation: {
        ...extractReconciliation,
        tedsMatchedWithLedger: tedsMatched,
      },
      dailyRecording: {
        storedDaysInRange: storedDates.length,
        storedDates,
        firstStoredDate: storedDays[0]?.snapshot_date ?? null,
        lastStoredDate: storedDays[storedDays.length - 1]?.snapshot_date ?? null,
        recordEndpoint: 'POST /api/invest/patrimony-daily/record',
      },
      marketQuotes: {
        tickersWithHistory: quoteMap.size,
        quoteRowsInRange: marketQuoteRows,
        usesHistoricalQuotes: quoteForDate != null,
      },
      performanceNotes: [
        storedDates.length > 0
          ? `${storedDates.length} dia(s) com fechamento gravado em invest_portfolio_daily (cron 23h ou npm run invest:daily-close).`
          : 'Sem fechamentos gravados ainda — o cron patrimony-daily (23h) passará a preencher dia a dia.',
        quoteForDate
          ? `Cotações históricas: ${quoteMap.size} ticker(s), ${marketQuoteRows} preço/dia em market_quotes_daily.`
          : 'Sem cotações em market_quotes_daily no período — rode sync:market:quotes:stocks e backfill:market:quotes.',
        calibrateToAnchors
          ? 'Série com calibração às âncoras mensais BTG.'
          : 'Série econômica: livro-razão × cotação do dia (ou PM quando sem cotação).',
        'Gráfico da carteira: TWR diário (rentab. acumulada), descontando aportes e retiradas (TEDs).',
        result.performance?.externalFlows?.length
          ? `${result.performance.externalFlows.length} fluxo(s) externo(s) no período (capital_deposit/withdrawal).`
          : 'Nenhum TED no livro — confira importação do extrato BTG.',
        cdiBenchmark.available
          ? `CDI: ${cdiBenchmark.observationDays} dia(s) em market_index_daily (índice 100 no gráfico).`
          : 'CDI indisponível — rode npm run sync:market:indices e confira migration 22.',
        chartStock && stockBenchmark.available
          ? `${chartStock}: ${stockBenchmark.observationDays} fechamento(s) em market_quotes_daily (buy-and-hold índice 100).`
          : chartStock
            ? `${chartStock} sem histórico — rode npm run seed:market:benchmarks.`
            : 'Benchmark de ação não definido (sem posição em ações/FIIs no livro).',
      ],
      patrimonySource: calibrateToAnchors
        ? 'ledger_plus_btg_anchors'
        : quoteForDate
          ? 'ledger_plus_market_quotes'
          : 'ledger_only',
    });
  };

  syncB3Quotes = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }
    const asOf = req.body?.date ? String(req.body.date).slice(0, 10) : undefined;
    try {
      const result = await this.quoteSync.syncFromBrapi(ctx, asOf);
      return res.json({
        success: true,
        ...result,
        note: 'Ações/FIIs via brapi. Opções: POST /api/invest/options/snapshot com last_price e option_strike.',
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Falha ao buscar cotações B3.',
      });
    }
  };

  /** Atualiza cotação e/ou strike de opções (dados Profit/BTG — strike não vem do ticker). */
  syncOptionSnapshot = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({
        success: false,
        error: 'Envie items: [{ ticker, option_strike?, last_price? }].',
      });
    }
    const asOf =
      req.body?.date != null
        ? String(req.body.date).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    try {
      const updated = await this.quoteSync.applySnapshotOptions(ctx, items, asOf);
      return res.json({ success: true, updated, asOf });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Falha ao gravar snapshot de opções.',
      });
    }
  };

  recordPatrimonyDaily = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }

    const dateParam = req.body?.date ? String(req.body.date).slice(0, 10) : undefined;
    try {
      const result = await this.patrimonyRecorder.recordDay(ctx, dateParam);
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Falha ao gravar patrimônio diário.',
      });
    }
  };

  getStockGainPivot = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }

    const bounds = await this.periodBoundsFor(ctx);
    const fromQ = String(req.query.from || bounds.defaultFrom).slice(0, 10);
    const from = fromQ < bounds.periodMin ? bounds.periodMin : fromQ;
    const toRaw = String(req.query.to || bounds.today).slice(0, 10);
    const to = toRaw > bounds.today ? bounds.today : toRaw;

    const events = await this.ledger.listLedgerEvents(ctx, from, to);
    let pivot = buildStockUnderlyingPivot(events, from, to);

    const underlyings = [
      ...new Set(pivot.rows.map((r) => String(r.underlying || '').toUpperCase()).filter(Boolean)),
    ];
    const marketMap = await this.marketQuoteRepo.loadLatestQuoteMap(ctx, underlyings);
    const quotesByTicker: Record<string, { lastPrice?: number }> = {};
    for (const [ticker, mq] of marketMap) {
      if (mq.price > 0) quotesByTicker[ticker] = { lastPrice: mq.price };
    }
    pivot = enrichStockPivotWithQuotes(pivot, quotesByTicker);

    const columnOrder = [
      ...STOCK_PIVOT_COLUMNS.filter((c) => c !== 'ganho_aproximado'),
      'ganho_aproximado',
    ];

    return res.json({
      success: true,
      columnLabels: STOCK_PIVOT_COLUMN_LABELS,
      columnOrder,
      pivot,
      periodBounds: bounds,
    });
  };

  getPnLPivot = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }

    const bounds = await this.periodBoundsFor(ctx);
    const fromQ = String(req.query.from || bounds.defaultFrom).slice(0, 10);
    const from = fromQ < bounds.periodMin ? bounds.periodMin : fromQ;
    const toRaw = String(req.query.to || bounds.today).slice(0, 10);
    const to = toRaw > bounds.today ? bounds.today : toRaw;

    const events = await this.ledger.listLedgerEvents(ctx, from, to);
    const pivot = buildPnLPivot(events, from, to);

    return res.json({
      success: true,
      columnLabels: PIVOT_COLUMN_LABELS,
      pivot,
      periodBounds: bounds,
    });
  };

  importLedger = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    const payload = req.body as LedgerImportPayload;
    if (!payload?.opening_date || !Array.isArray(payload.opening_positions)) {
      return res.status(400).json({
        success: false,
        error: 'Payload inválido: opening_date e opening_positions são obrigatórios.',
      });
    }
    if (!Array.isArray(payload.entries)) {
      payload.entries = [];
    }

    try {
      const result = await this.ledger.importPortfolio(ctx, payload);
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const message = err instanceof Error ? err.message : 'Falha na importação.';
      return res.status(status).json({ success: false, error: message });
    }
  };

  syncPendingSettlements = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    try {
      const result = await this.ledger.syncAutoPendingSettlements(ctx);
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const message =
        err instanceof Error ? err.message : 'Falha ao sincronizar lançamentos futuros.';
      return res.status(status).json({ success: false, error: message });
    }
  };

  reconcileCustody = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    try {
      const result = await this.ledger.reconcileCustody(ctx);
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const status = (err as { httpStatus?: number }).httpStatus ?? 500;
      const message = err instanceof Error ? err.message : 'Falha na conciliação.';
      return res.status(status).json({ success: false, error: message });
    }
  };

  /** Histórico de operações da base de dados. */
  listBrokerageNotesReview = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const rows = buildBrokerageNoteReviewRows(events, today);

    const notesCount = new Set<string>();
    let withFees = 0;
    let withoutFees = 0;
    for (const r of rows) {
      if (r.noteNumber && r.noteNumber !== '—') notesCount.add(r.noteNumber);
      const feeTotal =
        Math.abs(Number(r.settlementTax) || 0) +
        Math.abs(Number(r.registrationTax) || 0) +
        Math.abs(Number(r.emoluments) || 0) +
        Math.abs(Number(r.cblcTotal) || 0) +
        Math.abs(Number(r.bovespaTotal) || 0) +
        Math.abs(Number(r.irrf) || 0);
      if (feeTotal > 0.001) withFees += 1;
      else withoutFees += 1;
    }

    return res.json({
      success: true,
      ledgerImport: true,
      message:
        'Dados do livro razão. Taxas vêm da perna de caixa (metadata.fees); linhas sem taxa podem precisar reimportar notas BTG.',
      generatedAt: new Date().toISOString(),
      stats: {
        notesRaw: notesCount.size,
        notesKept: notesCount.size,
        notesDuplicateSkipped: 0,
        tradeLines: rows.length,
        linesWithFees: withFees,
        linesWithoutFees: withoutFees,
      },
      duplicatesSkipped: [],
      notes: [],
      rows,
    });
  };

  getExtract = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({ success: false, error: 'Sem organização.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const cashEvents = events.filter((e) => e.asset_type === 'cash');
    const tradeEvents = events.filter((e) => e.asset_type !== 'cash');

    const addDays = (dateStr: string, days: number) => {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
      if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };

    const notesTradeSummary = buildNotesTradeSummary(tradeEvents, addDays);
    const costByDate = buildCostAdjustmentIndex(tradeEvents);

    const rows = [];
    let balance = 0;

    for (const ce of cashEvents) {
      if (isDuplicateManualOpeningCash(ce, cashEvents)) continue;

      const amount = ce.total_net_value;
      balance += amount;
      let obs = '';
      let originDate = '';
      let ticker = '';
      const noteNum = normalizeBrokerNoteRef(ce.broker_note_ref) || ce.broker_note_ref || '';

      if (noteNum && notesTradeSummary.has(noteNum)) {
        const summary = notesTradeSummary.get(noteNum)!;
        originDate = summary.tradeDate;
        ticker = Array.from(summary.tickers).join(', ');

        const expectedCash = -summary.netValue;
        const diffReal = Math.abs(amount - expectedCash);

        if (diffReal > 0.02) {
          obs = `Diferença valor: Liq. ${expectedCash.toFixed(2)} vs Caixa ${amount.toFixed(2)}`;
        }

        if (ce.transaction_date !== summary.settlementDate) {
          obs += (obs ? '. ' : '') + `Liquidou em ${ce.transaction_date}, esperado ${summary.settlementDate}`;
        }
      } else {
        const desc = String(ce.notes || '');
        const inferred = inferFromCashDescription(desc, ce.transaction_date || '');
        if (inferred) {
          originDate = inferred.originDate;
          ticker = inferred.ticker;
        } else if (
          ce.transaction_type === 'fee' ||
          /taxa|emolumento|cust[oó]dia|corretagem/i.test(desc)
        ) {
          const absAmt = Math.round(Math.abs(amount) * 100) / 100;
          const hints = costByDate.get(ce.transaction_date || '') || [];
          const hit = hints.find((h) => Math.abs(h.amount - absAmt) < 0.03);
          if (hit) {
            ticker = hit.ticker;
            originDate = hit.date;
          }
        }
        if (
          !ticker &&
          ce.transaction_type !== 'capital_deposit' &&
          ce.transaction_type !== 'capital_withdrawal' &&
          ce.transaction_type !== 'opening_balance' &&
          amount !== 0
        ) {
          obs = 'Sem vínculo automático — conferir nota ou extrato';
        }
      }

      const isoDateToBr = (iso: string | undefined | null) => {
        const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
      };

      rows.push({
        id: ce.id,
        date: ce.transaction_date || '',
        dateBr: isoDateToBr(ce.transaction_date),
        description: ce.notes || (ce.transaction_type === 'opening_balance' ? 'Saldo Inicial' : 'Movimentação'),
        inflow: amount > 0 ? amount : null,
        outflow: amount < 0 ? Math.abs(amount) : null,
        balance: balance,
        originDate: isoDateToBr(originDate),
        ticker,
        noteNum,
        observation: obs,
      });
    }
    
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return res.json({
      success: true,
      rows,
    });
  };

  /** Popula CDI + ação benchmark em tabelas globais — escopo plataforma. */
  seedMarketBenchmarks = async (req: Request, res: Response) => {
    if (req.userContext?.scope !== 'global') {
      return res.status(403).json({
        success: false,
        error: 'Somente sessão plataforma (escopo global) pode popular benchmarks de mercado.',
      });
    }
    const from = String(req.body?.from || req.query.from || '').slice(0, 10);
    const to = String(req.body?.to || req.query.to || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const stockTicker = String(
      req.body?.stockTicker || req.query.stockTicker || process.env.INVEST_CHART_BENCHMARK_TICKER || ''
    )
      .trim()
      .toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res.status(400).json({
        success: false,
        error: 'Informe from (YYYY-MM-DD) no corpo ou query.',
      });
    }
    if (!stockTicker) {
      return res.status(400).json({
        success: false,
        error: 'Informe stockTicker ou configure INVEST_CHART_BENCHMARK_TICKER.',
      });
    }
    try {
      const result = await seedMarketBenchmarks(this.gateway, pool, { from, to, stockTicker });
      return res.json({ success: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ success: false, error: message });
    }
  };

  /** Cotações atuais de ações/FIIs em uso → market_quotes_daily (escopo plataforma). */
  syncMarketStocks = async (req: Request, res: Response) => {
    if (req.userContext?.scope !== 'global') {
      return res.status(403).json({
        success: false,
        error: 'Somente sessão plataforma pode sincronizar cotações globais de ações.',
      });
    }
    const asOf = req.body?.date ? String(req.body.date).slice(0, 10) : undefined;
    try {
      const report = await new StockMarketSyncService(this.gateway).syncFromBrapi(
        authBootstrapContext(),
        asOf
      );
      return res.json({ success: true, ...report });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ success: false, error: message });
    }
  };

}
