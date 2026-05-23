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
import { buildDailyPatrimonyMtmSeries } from '../core/invest/PatrimonyMtmDailyEngine';
import { buildExtractReconciliationSummary } from '../core/invest/btgExtractCashSeries';
import { compareToBtgPublished } from '../core/invest/btgPerformanceReference';
import { loadPatrimonyAnchors } from '../core/invest/patrimonyAnchors';
import {
  fixedIncomeTotalFromLedger,
  shouldUseBtgAnchorCalibration,
} from '../core/invest/patrimonyLedgerGates';
import { InvestQuoteSyncService } from '../core/invest/InvestQuoteSyncService';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';
import { InvestAssetProjection } from '../modules/invest/sync/InvestAssetProjection';
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
import { buildCashInTransitSummary } from '../core/invest/cashInTransit';
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
  private readonly assetProjection: InvestAssetProjection;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyStore = new PatrimonyDailyStore(gateway);
    this.patrimonyRecorder = new PatrimonyDailyRecorder(gateway);
    this.quoteSync = new InvestQuoteSyncService(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
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

    const rows = await this.assetProjection.listActiveAssets(ctx);

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
    const cashInTransit = buildCashInTransitSummary(ledgerEvents, today);
    const withCash = applyCashInvestBalanceToItems(
      withCallCoverage,
      cashInTransit.settledCashBalance
    );

    return res.json({
      success: true,
      items: withCash,
      closedOptions,
      summary: summarizePortfolio(withCash),
      cashStatementBalance: cashInTransit.settledCashBalance,
      cashInTransit,
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

    const anchors = loadPatrimonyAnchors();
    const calibrateToAnchors =
      method === 'mtm_btg' && shouldUseBtgAnchorCalibration(events);
    const fixedIncomeTotal = calibrateToAnchors
      ? Number(anchors.fixed_income_total ?? 0)
      : fixedIncomeTotalFromLedger(events);

    let result =
      method === 'ledger_replay'
        ? buildDailyPatrimonySeries(events, from, to, {
            riskFreeAnnual: Number.isFinite(riskFreeAnnual) ? riskFreeAnnual : 0,
          })
        : buildDailyPatrimonyMtmSeries(events, from, to, {
            riskFreeAnnual: Number.isFinite(riskFreeAnnual) ? riskFreeAnnual : 0,
            anchors,
            stockQuotes,
            fixedIncomeTotal,
            calibrateToAnchors,
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

    const cashInTransit = buildCashInTransitSummary(events, to);

    return res.json({
      success: true,
      ...result,
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
      performanceNotes: [
        storedDates.length > 0
          ? `${storedDates.length} dia(s) com fechamento gravado (patrimônio econômico real + cotações do dia).`
          : 'A partir de agora: execute record-daily-patrimony 1x/dia após atualizar cotações para construir histórico detalhado.',
        calibrateToAnchors
          ? 'Série estimada com âncoras mensais BTG até haver fechamentos gravados dia a dia.'
          : 'Série somente do livro-razão (sem âncoras BTG). Importe abertura 01/01/2026 e movimentações para evoluir a curva.',
        'TWR principal em períodos longos: fechamentos mensais BTG; TWR diário gravado usa só TED/aportes como fluxo externo.',
      ],
      patrimonySource: calibrateToAnchors ? 'ledger_plus_btg_anchors' : 'ledger_only',
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

    const assets = await this.assetProjection.listActiveAssets(ctx);
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
    const tradeEvents = events.filter((e) => e.asset_type !== 'cash');

    const isoDateToBr = (iso: string): string => {
      const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return iso;
      return `${m[3]}/${m[2]}/${m[1]}`;
    };

    const rows = [];
    const notesCount = new Set<string>();
    const noteNets = new Map<string, number>();

    for (const e of tradeEvents) {
      if (e.broker_note_ref) {
        const current = noteNets.get(e.broker_note_ref) || 0;
        noteNets.set(e.broker_note_ref, current + e.total_net_value);
      }
    }

    const noteLineCount = new Map<string, number>();

    for (const e of tradeEvents) {
      const noteNum = e.broker_note_ref || '—';
      const lineNo = (noteLineCount.get(noteNum) || 0) + 1;
      noteLineCount.set(noteNum, lineNo);
      if (e.broker_note_ref) {
        notesCount.add(e.broker_note_ref);
      }

      let side: 'C' | 'V' | '—' = '—';
      if (e.transaction_type.includes('buy')) {
        side = 'C';
      } else if (e.transaction_type.includes('sell')) {
        side = 'V';
      } else if (e.transaction_type === 'acquisition') {
        side = 'C';
      } else if (e.transaction_type === 'disposition') {
        side = 'V';
      } else if (e.quantity > 0) {
        side = 'C';
      } else if (e.quantity < 0) {
        side = 'V';
      }

      let category = 'SPOT';
      if (e.asset_type === 'option_call' || e.asset_type === 'option_put') {
        category = 'OPTIONS';
      } else if (e.transaction_type === 'loan' || e.asset_type === 'loan') {
        category = 'LOAN';
      }

      const grossValue = Math.abs(e.total_net_value);
      const isExercise = e.transaction_type === 'option_exercise';

      const pregaoDate = e.transaction_date || today;
      rows.push({
        dedupeKey: `DB|${e.id}`,
        noteNumber: noteNum,
        pregaoDate: pregaoDate,
        pregaoDateBr: isoDateToBr(pregaoDate),
        category,
        sourceFile: e.notes || 'Livro razão',
        netOperations: e.broker_note_ref ? noteNets.get(e.broker_note_ref) : e.total_net_value,
        settlementTax: 0,
        registrationTax: 0,
        cblcTotal: 0,
        emoluments: 0,
        bovespaTotal: 0,
        irrf: e.irrf_tax || 0,
        duplicateSkipped: false,
        duplicateOf: null,
        lineNo,
        side,
        sideLabel: side === 'C' ? 'Compra' : side === 'V' ? 'Venda' : '—',
        marketType: isExercise ? 'EXERCÍCIO' : category === 'OPTIONS' ? 'OPÇÕES' : 'VISTA',
        operationLabel: isExercise ? 'Exercício' : side === 'C' ? 'Compra' : 'Venda',
        maturity: null,
        ticker: e.asset_ticker,
        underlyingStock: e.underlying_ticker || e.asset_ticker,
        isExercise,
        specification: '',
        quantity: Math.abs(e.quantity),
        unitPrice: e.unit_price,
        grossValue,
        dc: side === 'C' ? 'D' : side === 'V' ? 'C' : '—',
      });
    }

    rows.sort((a, b) => {
      const d = String(a.pregaoDate).localeCompare(String(b.pregaoDate));
      if (d !== 0) return d;
      return String(a.noteNumber).localeCompare(String(b.noteNumber));
    });

    return res.json({
      success: true,
      ledgerImport: true,
      message: 'Dados lidos diretamente do banco de dados.',
      generatedAt: new Date().toISOString(),
      stats: {
        notesRaw: notesCount.size,
        notesKept: notesCount.size,
        notesDuplicateSkipped: 0,
        tradeLines: rows.length,
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

    const notesTradeSummary = new Map<string, {
      netValue: number,
      tickers: Set<string>,
      tradeDate: string,
      settlementDate: string,
    }>();

    const addDays = (dateStr: string, days: number) => {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
      if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };

    for (const e of tradeEvents) {
      if (e.broker_note_ref && e.transaction_date) {
        const t = e.asset_ticker?.toUpperCase() || '';
        const isOptionsOrFixed = e.asset_type === 'option_call' || e.asset_type === 'option_put' || 
          t.startsWith('LFT') || t.startsWith('CDB') || t.startsWith('LTN') || t.startsWith('NTN');
        const daysToSettle = isOptionsOrFixed ? 1 : 2;
        const settlement = addDays(e.transaction_date, daysToSettle);
        
        let summary = notesTradeSummary.get(e.broker_note_ref);
        if (!summary) {
          summary = { netValue: 0, tickers: new Set(), tradeDate: e.transaction_date, settlementDate: settlement };
          notesTradeSummary.set(e.broker_note_ref, summary);
        }
        summary.netValue += e.total_net_value;
        if (e.asset_ticker) summary.tickers.add(e.asset_ticker);
        
        if (settlement > summary.settlementDate) {
          summary.settlementDate = settlement;
        }
      }
    }

    const rows = [];
    let balance = 0;

    for (const ce of cashEvents) {
      const amount = ce.total_net_value;
      balance += amount;
      let obs = '';
      let originDate = '';
      let ticker = '';
      let noteNum = ce.broker_note_ref || '';

      if (noteNum && notesTradeSummary.has(noteNum)) {
        const summary = notesTradeSummary.get(noteNum)!;
        originDate = summary.tradeDate;
        ticker = Array.from(summary.tickers).join(', ');
        
        // trade netValue is positive for BUYS. Cash amount is negative for OUTFLOW (buys).
        // So cashAmount + tradeNetValue should be 0.
        const expectedCash = -summary.netValue;
        const diffReal = Math.abs(amount - expectedCash);
        
        if (diffReal > 0.02) {
          obs = `Diferença valor: Liq. ${expectedCash.toFixed(2)} vs Caixa ${amount.toFixed(2)}`;
        }
        
        if (ce.transaction_date !== summary.settlementDate) {
          obs += (obs ? '. ' : '') + `Liquidou em ${ce.transaction_date}, esperado ${summary.settlementDate}`;
        }
      } else if (ce.transaction_type === 'capital_deposit' || ce.transaction_type === 'capital_withdrawal') {
         // TED normal
      } else if (ce.transaction_type === 'opening_balance') {
         // Saldo inicial
      } else if (amount !== 0) {
        obs = 'Sem relação encontrada ou sem nota (LIQ BOLSA?)';
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

}
