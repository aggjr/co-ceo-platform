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
import { buildDailyPatrimonyMtmSeries } from '../core/invest/PatrimonyMtmDailyEngine';
import { buildExtractReconciliationSummary } from '../core/invest/btgExtractCashSeries';
import { compareToBtgPublished } from '../core/invest/btgPerformanceReference';
import { loadPatrimonyAnchors } from '../core/invest/patrimonyAnchors';
import { InvestQuoteSyncService } from '../core/invest/InvestQuoteSyncService';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';
import {
  mergeStoredPatrimonySeries,
  PatrimonyDailyStore,
} from '../core/invest/PatrimonyDailyStore';
import { listExternalFlows } from '../core/invest/portfolioPerformance';
import {
  attachCallCoverageToEquities,
  buildShortCallPremiumPendingByUnderlying,
  collectCallCoverageOptionRows,
} from '../core/invest/callCoverage';
import { rebuildCustodyFromLedger } from '../core/invest/CustodyEngine';
import { resolveCashInvestDisplayBalance } from '../core/invest/cashInvestLedger';
import {
  applyAllocationPercents,
  applyCashInvestBalanceToItems,
  enrichPortfolioRow,
  attachUnderlyingMarketData,
  consolidateTesouroPortfolioItems,
  mergeLedgerCustodyIntoAssetRows,
  partitionPortfolioPositions,
  summarizePortfolio,
} from '../core/invest/portfolioMapper';
import {
  buildThreeAvgPricesByUnderlying,
  resolveThreePricesForAsset,
} from '../core/invest/portfolioThreePrices';
import type { LedgerImportPayload } from '../core/invest/ledgerTypes';

export class InvestController {
  private readonly ledger: LedgerImportService;
  private readonly patrimonyStore: PatrimonyDailyStore;
  private readonly patrimonyRecorder: PatrimonyDailyRecorder;
  private readonly quoteSync: InvestQuoteSyncService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyStore = new PatrimonyDailyStore(gateway);
    this.patrimonyRecorder = new PatrimonyDailyRecorder(gateway);
    this.quoteSync = new InvestQuoteSyncService(gateway);
  }

  listPortfolio = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error:
          'Selecione uma organização para ver o portfólio (ex.: personifique o titular da holding).',
      });
    }

    const rows = await this.gateway.findWhere(ctx, 'invest_assets', {
      organization_id: ctx.organizationId,
      status: 'active',
    });

    const today = new Date().toISOString().slice(0, 10);
    const ledgerEvents = await this.ledger.listLedgerEvents(
      ctx,
      '2000-01-01',
      today
    );
    const { assets: ledgerCustody } = rebuildCustodyFromLedger(ledgerEvents);
    const rowsMerged = mergeLedgerCustodyIntoAssetRows(
      rows as Record<string, unknown>[],
      ledgerCustody
    );
    const threeByUnderlying = buildThreeAvgPricesByUnderlying(ledgerEvents);

    const items = [];
    for (const row of rowsMerged) {
      const filtered = await FieldPolicyService.filterRowForRead(
        ctx.roleId,
        ctx.organizationId,
        'invest_assets',
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
      items.push(enrichPortfolioRow(filtered, three));
    }

    const withUnderlyingQuotes = attachUnderlyingMarketData(items);
    withUnderlyingQuotes.sort((a, b) => b.marketValue - a.marketValue);
    const { open, closedOptions } = partitionPortfolioPositions(withUnderlyingQuotes);
    const consolidated = consolidateTesouroPortfolioItems(open);
    const withAllocation = applyAllocationPercents(consolidated);

    const coverageOptions = collectCallCoverageOptionRows(
      withAllocation,
      ledgerCustody
    );
    const premiumByUnderlying = buildShortCallPremiumPendingByUnderlying(ledgerEvents);
    const withCallCoverage = attachCallCoverageToEquities(
      withAllocation,
      coverageOptions,
      premiumByUnderlying
    );
    const cashBalance = resolveCashInvestDisplayBalance(ledgerEvents, today);
    const withCash = applyCashInvestBalanceToItems(withCallCoverage, cashBalance);

    return res.json({
      success: true,
      items: withCash,
      closedOptions,
      summary: summarizePortfolio(withCash),
      cashStatementBalance: cashBalance,
      source: 'custody',
    });
  };

  getPatrimonyDaily = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Selecione uma organização (personifique a holding).',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from || '2026-01-01').slice(0, 10);
    const toRaw = String(req.query.to || today).slice(0, 10);
    const to = toRaw > today ? today : toRaw;
    const riskFreeAnnual = Number(req.query.risk_free ?? 0);

    const events = await this.ledger.listLedgerEvents(ctx, from, to);
    const method = String(req.query.method || 'mtm_btg').toLowerCase();

    let stockQuotes: Record<string, number> | undefined;
    if (method === 'mtm_btg') {
      const assets = await this.gateway.findWhere(ctx, 'invest_assets', {
        organization_id: ctx.organizationId,
        status: 'active',
      });
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

    const anchors = loadPatrimonyAnchors();
    let result =
      method === 'ledger_replay'
        ? buildDailyPatrimonySeries(events, from, to, {
            riskFreeAnnual: Number.isFinite(riskFreeAnnual) ? riskFreeAnnual : 0,
          })
        : buildDailyPatrimonyMtmSeries(events, from, to, {
            riskFreeAnnual: Number.isFinite(riskFreeAnnual) ? riskFreeAnnual : 0,
            anchors,
            stockQuotes,
            fixedIncomeTotal: Number(anchors.fixed_income_total ?? 0),
          });

    const storedDays = await this.patrimonyStore.loadRange(ctx, from, to);
    let storedDates: string[] = [];
    if (storedDays.length > 0) {
      const merged = mergeStoredPatrimonySeries(result.series, storedDays);
      result = { ...result, series: merged.series };
      storedDates = merged.storedDates;
    }

    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);
    const btgReference =
      result.performance != null
        ? compareToBtgPublished(result.performance.periodReturnTwr, fromMonth, toMonth)
        : null;

    const extractReconciliation = buildExtractReconciliationSummary();
    const ledgerFlows = listExternalFlows(events, from, to);
    const tedsMatched =
      extractReconciliation.tedsInExtract.length === 0 ||
      extractReconciliation.tedsInExtract.every((et) =>
        ledgerFlows.some((f) => f.date === et.date && Math.abs(f.amount - et.amount) < 0.02)
      );

    return res.json({
      success: true,
      ...result,
      btgReference,
      extractReconciliation: {
        ...extractReconciliation,
        tedsMatchedWithLedger: tedsMatched,
        importSource: 'data/invest/btg-augusto-h1-2026.json',
        extractSourcesDir: 'data/invest/sources/btg-extracts/',
      },
      dailyRecording: {
        storedDaysInRange: storedDates.length,
        storedDates,
        firstStoredDate: storedDays[0]?.snapshot_date ?? null,
        lastStoredDate: storedDays[storedDays.length - 1]?.snapshot_date ?? null,
        recordEndpoint: 'POST /api/invest/patrimony-daily/record',
      },
      performanceNotes: [
        storedDates.length > 0
          ? `${storedDates.length} dia(s) com fechamento gravado (patrimônio econômico real + cotações do dia).`
          : 'A partir de agora: execute record-daily-patrimony 1x/dia após atualizar cotações para construir histórico detalhado.',
        'Antes do primeiro fechamento gravado: série estimada (âncoras BTG + cotação atual).',
        'TWR principal em períodos longos: fechamentos mensais BTG; TWR diário gravado usa só TED/aportes como fluxo externo.',
      ],
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

    const today = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from || '2026-01-01').slice(0, 10);
    const to = String(req.query.to || today).slice(0, 10);

    const events = await this.ledger.listLedgerEvents(ctx, from, to);
    let pivot = buildStockUnderlyingPivot(events, from, to);

    const assets = await this.gateway.findWhere(ctx, 'invest_assets', {
      organization_id: ctx.organizationId,
      status: 'active',
    });
    const quotesByTicker: Record<string, { lastPrice?: number }> = {};
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
      if (Number.isFinite(lp) && lp > 0) quotesByTicker[ticker] = { lastPrice: lp };
    }
    pivot = enrichStockPivotWithQuotes(pivot, quotesByTicker);

    return res.json({
      success: true,
      columnLabels: STOCK_PIVOT_COLUMN_LABELS,
      columnOrder: [...STOCK_PIVOT_COLUMNS],
      pivot,
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

    const today = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from || '2026-01-01').slice(0, 10);
    const to = String(req.query.to || today).slice(0, 10);

    const events = await this.ledger.listLedgerEvents(ctx, from, to);
    const pivot = buildPnLPivot(events, from, to);

    return res.json({
      success: true,
      columnLabels: PIVOT_COLUMN_LABELS,
      pivot,
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

}
