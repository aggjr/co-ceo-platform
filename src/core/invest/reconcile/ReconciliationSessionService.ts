import type { CoCeoDataGateway, UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import type { LedgerEvent } from '../CustodyEngine';
import { LedgerImportService } from '../LedgerImportService';
import { PatrimonyDailyRecorder } from '../PatrimonyDailyRecorder';
import { PatrimonyDailyStore } from '../PatrimonyDailyStore';
import { PatrimonyDailyRebuildService } from '../PatrimonyDailyRebuildService';
import type { BtgUploadFileInput } from '../btgUploadImportService';
import { previewBtgBrokerageUpload } from '../btgUploadImportService';
import { buildBrokerageNoteReviewRows } from '../brokerageNotesReviewFromLedger';
import { resolveInvestPeriodBounds } from '../investPeriodBounds';
import { ReconciliationAuditService } from './ReconciliationAuditService';
import { ReconciliationSessionStore, type ReconciliationPhase } from './ReconciliationSessionStore';
import {
  allowedActionsForKind,
  type ReconcileAction,
  type ReconcileDecision,
} from './auditTypes';
import { buildNotesFileIndex, type NoteFilePreviewRow } from './reconcileNotesIndex';
import type { LedgerImportLine } from '../ledgerTypes';
import {
  HoldingPurgeKeepOpeningService,
  type ReconcilePreflightResult,
} from '../HoldingPurgeKeepOpeningService';
import type { Pool } from 'mysql2/promise';
import {
  reconcileActivity,
  type ReconcileActivityStep,
} from './reconcileActivity';
import type { BtgBrokerageFileResult } from '../btgUploadImportService';
import { DailyCloseMaterializeService } from './DailyCloseMaterializeService';
import { ensureInvestReconciliationSchema } from '../../db/ensureInvestReconciliationSchema';

export type ReconcileDataMode = 'recover' | 'reset_from_opening';

const MONEY_TOL = 0.02;

export type ReconcileRowStatus =
  | 'matched'
  | 'different'
  | 'ledger_only'
  | 'file_only'
  | 'skipped'
  | 'blocked';

export type DayPreviewRow = {
  rowKey: string;
  status: ReconcileRowStatus;
  source: 'ledger' | 'file';
  ticker: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
  ledgerEntryId?: string;
  noteNumber?: string;
  skipConfirmed?: boolean;
};

type SessionRuntime = {
  phase: ReconciliationPhase;
  files: BtgUploadFileInput[];
  calendar: string[];
  noteLinesByDate: Record<string, NoteFilePreviewRow[]>;
  linesByRowKey: Map<string, LedgerImportLine>;
  resolvedByDay: Map<string, Map<string, ReconcileAction>>;
};

const runtimeBySession = new Map<string, SessionRuntime>();

function ledgerRowKey(e: LedgerEvent): string {
  return e.id ? `pat:${e.id}` : `pat:${e.asset_ticker}:${e.transaction_date}`;
}

function tradeOnDate(e: LedgerEvent, date: string): boolean {
  return String(e.transaction_date).slice(0, 10) === date;
}

function isPatrimonyTrade(e: LedgerEvent): boolean {
  if (e.asset_type === 'cash') return false;
  const tx = String(e.transaction_type);
  return (
    tx === 'buy' ||
    tx === 'sell' ||
    tx === 'call_buy' ||
    tx === 'call_sell' ||
    tx === 'put_buy' ||
    tx === 'put_sell' ||
    tx === 'opening_balance'
  );
}

function matchTrade(
  file: NoteFilePreviewRow,
  ledger: LedgerEvent
): boolean {
  return (
    String(file.ticker).toUpperCase() === String(ledger.asset_ticker).toUpperCase() &&
    Math.abs(Number(file.quantity) - Math.abs(Number(ledger.quantity))) < 0.0001 &&
    Math.abs(Number(file.unitPrice) - Math.abs(Number(ledger.unit_price))) < MONEY_TOL
  );
}

function previewRowToDecision(row: DayPreviewRow): ReconcileDecision {
  const kind = row.status;
  return {
    decisionId: `preview:${row.rowKey}`,
    source: 'preview',
    kind,
    severity: row.status === 'blocked' ? 'critical' : 'warn',
    summaryKey: `invest.reconcile.preview.${kind}`,
    context: {
      rowKey: row.rowKey,
      ticker: row.ticker,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
    },
    rowKeys: [row.rowKey],
    allowedActions: allowedActionsForKind(kind),
  };
}

export class ReconciliationSessionService {
  private readonly store: ReconciliationSessionStore;
  private readonly ledger: LedgerImportService;
  private readonly audit: ReconciliationAuditService;
  private readonly patrimonyRecorder: PatrimonyDailyRecorder;
  private readonly patrimonyStore: PatrimonyDailyStore;
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly dailyClose: DailyCloseMaterializeService;

  private readonly holdingPurge: HoldingPurgeKeepOpeningService | null;
  private readonly dbPool: Pool | null;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    pool?: Pool
  ) {
    this.dbPool = pool ?? null;
    this.store = new ReconciliationSessionStore(gateway);
    this.ledger = new LedgerImportService(gateway);
    this.audit = new ReconciliationAuditService(gateway);
    this.patrimonyRecorder = new PatrimonyDailyRecorder(gateway);
    this.patrimonyStore = new PatrimonyDailyStore(gateway);
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.dailyClose = new DailyCloseMaterializeService(gateway);
    this.holdingPurge = pool ? new HoldingPurgeKeepOpeningService(gateway, pool) : null;
  }

  async preflight(ctx: UserContext): Promise<ReconcilePreflightResult> {
    if (!this.holdingPurge) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'Pré-voo de conciliação indisponível (pool não configurado).',
        503
      );
    }
    return this.holdingPurge.preflight(ctx);
  }

  async resetHoldingFromOpening(ctx: UserContext) {
    if (!this.holdingPurge) {
      throw new GatewayError('INVALID_CONTEXT', 'Reset da holding indisponível.', 503);
    }
    return this.holdingPurge.purgeKeepOpening(ctx);
  }

  async startSession(
    ctx: UserContext,
    input: {
      phase: ReconciliationPhase;
      files: BtgUploadFileInput[];
      dataMode?: ReconcileDataMode;
    }
  ) {
    const orgId = ctx.organizationId ?? undefined;
    const activityLog: ReconcileActivityStep[] = [];
    const log = (message: string, command: string, level?: ReconcileActivityStep['level']) => {
      activityLog.push(reconcileActivity(orgId, message, { command, level }));
    };

    log(`Início sessão fase=${input.phase}`, 'session.start');

    let schemaApplied = false;
    if (this.dbPool) {
      const schema = await ensureInvestReconciliationSchema(this.dbPool);
      schemaApplied = schema.applied;
      if (schema.applied) {
        log(
          `Schema conciliação aplicado (${schema.migrationFile})`,
          'schema.ensure',
          'ok'
        );
        console.log(
          `[invest:reconcile] org=${orgId ?? '?'} [schema.ensure] Migration ${schema.migrationFile} aplicada`
        );
      }
    }

    if (input.phase === 'cash') {
      await this.assertNotesPhaseComplete(ctx);
    }
    if (input.phase === 'notes' && (!input.files?.length)) {
      throw new GatewayError('INVALID_PAYLOAD', 'Envie ao menos um PDF de notas.', 400);
    }

    if (input.phase === 'notes' && this.holdingPurge) {
      const pf = await this.holdingPurge.preflight(ctx);
      if (pf.needsDataModeChoice && !input.dataMode) {
        throw new GatewayError(
          'INVALID_PAYLOAD',
          'Escolha recover (recuperar) ou reset_from_opening (refazer do zero) antes de iniciar.',
          400
        );
      }
      if (input.dataMode === 'reset_from_opening') {
        log('Purge da holding (reset_from_opening)', 'purge.start', 'warn');
        const purgeResult = await this.holdingPurge.purgeKeepOpening(ctx);
        activityLog.push(...(purgeResult.activityLog ?? []));
      } else {
        log('Modo recover — livro atual preservado', 'session.recover', 'info');
      }
    }

    let fileResults: BtgBrokerageFileResult[] = [];
    const previewSummary =
      input.phase === 'notes' ? await previewBtgBrokerageUpload(input.files) : null;
    if (previewSummary) {
      fileResults = previewSummary.fileResults ?? [];
      log(
        `Preview notas: ${previewSummary.filesOk}/${previewSummary.filesTotal} PDF(s) OK, ${previewSummary.notesKept} nota(s)`,
        'notes.preview',
        'ok'
      );
      for (const f of fileResults) {
        log(
          `${f.fileName}: ${f.parseOk ? `${f.notesCount} nota(s), ${f.ledgerLines} linha(s)` : f.parseError || 'erro'}`,
          'notes.file',
          f.parseOk ? 'ok' : 'error'
        );
      }
    }

    const index =
      input.phase === 'notes'
        ? await buildNotesFileIndex(input.files)
        : { calendar: [], noteLinesByDate: {}, linesByRowKey: new Map() };

    log(`Calendário: ${index.calendar.length} dia(s) de pregão`, 'notes.calendar', 'ok');

    const baselineAudit = await this.audit.run(ctx);

    const session = await this.store.createSession(ctx, {
      phase: input.phase,
      fileIndex: {
        filesCount: input.files?.length ?? 0,
        calendar: index.calendar,
        preview: previewSummary,
      },
    });

    runtimeBySession.set(session.id, {
      phase: input.phase,
      files: input.files ?? [],
      calendar: index.calendar,
      noteLinesByDate: index.noteLinesByDate,
      linesByRowKey: index.linesByRowKey,
      resolvedByDay: new Map(),
    });

    log(`Sessão ${session.id} criada`, 'session.created', 'ok');

    return {
      sessionId: session.id,
      calendar: index.calendar,
      baselineAudit,
      session,
      activityLog,
      fileResults,
      schemaApplied,
      importProgress: {
        filesTotal: fileResults.length,
        filesProcessed: fileResults.filter((f) => f.parseOk).length,
        filesFailed: fileResults.filter((f) => !f.parseOk).length,
        percent:
          fileResults.length > 0
            ? Math.round(
                (100 * fileResults.filter((f) => f.parseOk).length) / fileResults.length
              )
            : 0,
      },
    };
  }

  async getSession(ctx: UserContext, sessionId: string) {
    const session = await this.store.getById(ctx, sessionId);
    if (!session) {
      throw new GatewayError('RECORD_NOT_FOUND', 'Sessão não encontrada.', 404);
    }
    const audit = await this.audit.run(ctx, {
      throughDate: session.horizon_trusted_through ?? undefined,
    });
    return { session, audit };
  }

  async getDay(ctx: UserContext, sessionId: string, businessDate: string) {
    const session = await this.requireSession(ctx, sessionId);
    const preview = await this.buildDayPreview(ctx, sessionId, businessDate);
    const audit = await this.audit.run(ctx, {
      throughDate: businessDate,
      scope: 'through',
      horizonTrustedThrough: session.horizon_trusted_through,
    });
    const pendingDecisions = this.mergePendingDecisions(
      sessionId,
      businessDate,
      preview,
      audit.pendingDecisions
    );
    const canClose = pendingDecisions.length === 0 && this.evaluateCanClose(preview);
    return {
      preview,
      pendingDecisions,
      canClose,
      blockReasons: canClose ? [] : ['invest.reconcile.block.pending_decisions'],
      horizonTrustedThrough: session.horizon_trusted_through,
    };
  }

  async resolveDecision(
    ctx: UserContext,
    sessionId: string,
    businessDate: string,
    input: { decisionId: string; action: ReconcileAction }
  ) {
    const runtime = this.requireRuntime(sessionId);
    const session = await this.requireSession(ctx, sessionId);
    const dayResolved = runtime.resolvedByDay.get(businessDate) ?? new Map();
    const preview = await this.buildDayPreview(ctx, sessionId, businessDate);
    const audit = await this.audit.run(ctx, {
      throughDate: businessDate,
      scope: 'through',
      horizonTrustedThrough: session.horizon_trusted_through,
    });
    const pending = this.mergePendingDecisions(
      sessionId,
      businessDate,
      preview,
      audit.pendingDecisions
    );
    const decision = pending.find((d) => d.decisionId === input.decisionId);
    if (!decision) {
      throw new GatewayError('INVALID_PAYLOAD', 'Decisão não encontrada ou já resolvida.', 400);
    }
    if (!decision.allowedActions.includes(input.action)) {
      throw new GatewayError('INVALID_PAYLOAD', 'Ação não permitida para esta pendência.', 400);
    }
    if (input.action === 'defer' || input.action === 'confirm_skipped') {
      dayResolved.set(input.decisionId, input.action);
      runtime.resolvedByDay.set(businessDate, dayResolved);
      return this.getDay(ctx, sessionId, businessDate);
    }

    if (input.action === 'insert_from_file' && decision.rowKeys?.[0]) {
      const line = runtime.linesByRowKey.get(decision.rowKeys[0]);
      if (!line) {
        throw new GatewayError('INVALID_PAYLOAD', 'Linha do arquivo não encontrada na sessão.', 400);
      }
      await this.ledger.importEntriesOnly(ctx, [line], { sourceLabel: 'reconcile_session' });
    } else if (input.action === 'void_ledger' && decision.rowKeys?.[0]) {
      const ledgerId = decision.rowKeys[0].replace(/^pat:/, '');
      if (ledgerId) {
        await this.gateway.softDelete(ctx, 'patrimony_ledger_entries', ledgerId);
      }
    } else if (
      input.action === 'keep_ledger_row' ||
      input.action === 'pair_rows'
    ) {
      /* v1: marca resolvido — pareamento fino em task futura */
    }

    dayResolved.set(input.decisionId, input.action);
    runtime.resolvedByDay.set(businessDate, dayResolved);

    await this.store.appendDayLog(ctx, {
      sessionId,
      businessDate,
      action: 'resolve',
      userDecisions: [
        {
          decisionId: input.decisionId,
          action: input.action,
          at: new Date().toISOString(),
          userId: ctx.userId ?? undefined,
          rowKeys: decision.rowKeys,
        },
      ],
    });

    return this.getDay(ctx, sessionId, businessDate);
  }

  async closeDay(ctx: UserContext, sessionId: string, businessDate: string) {
    const dayState = await this.getDay(ctx, sessionId, businessDate);
    if (!dayState.canClose) {
      const err = new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        'Dia com pendências não resolvidas.',
        409
      );
      (err as GatewayError & { details?: unknown }).details = {
        pendingDecisions: dayState.pendingDecisions,
        blockReasons: dayState.blockReasons,
      };
      throw err;
    }

    await this.materializeThroughDate(ctx, businessDate);

    const session = await this.requireSession(ctx, sessionId);
    const progress = { ...(session.progress_by_day ?? {}) };
    progress[businessDate] = 'closed';

    const updated = await this.store.updateSession(ctx, sessionId, {
      horizon_trusted_through: businessDate,
      progress_by_day: progress,
    });

    const audit = await this.audit.run(ctx, {
      throughDate: businessDate,
      scope: 'through',
      horizonTrustedThrough: businessDate,
    });
    await this.store.appendDayLog(ctx, {
      sessionId,
      businessDate,
      action: 'close',
      auditSnapshot: audit,
    });

    return {
      closed: true,
      horizon: updated.horizon_trusted_through,
      audit,
      session: updated,
    };
  }

  async completePhase(ctx: UserContext, sessionId: string) {
    const session = await this.requireSession(ctx, sessionId);
    if (session.phase === 'notes') {
      const updated = await this.store.updateSession(ctx, sessionId, {
        status: 'notes_complete',
        completed_at: new Date().toISOString(),
      });
      const audit = await this.audit.run(ctx);
      return { session: updated, nextPhase: 'cash' as const, audit };
    }
    const updated = await this.store.updateSession(ctx, sessionId, {
      status: 'cash_complete',
      completed_at: new Date().toISOString(),
    });
    const audit = await this.audit.run(ctx);
    return { session: updated, audit };
  }

  async runAudit(ctx: UserContext, opts?: { through?: string }) {
    return this.audit.run(ctx, {
      throughDate: opts?.through,
      scope: opts?.through ? 'through' : 'full',
    });
  }

  async getAsOf(ctx: UserContext, asOfDate: string) {
    const sessionRows = await this.gateway.findWhere(
      ctx,
      'invest_reconciliation_sessions',
      { status: 'in_progress' },
      { limit: 1 }
    );
    const horizon =
      sessionRows[0]?.horizon_trusted_through != null
        ? String(sessionRows[0].horizon_trusted_through).slice(0, 10)
        : null;

    const audit = await this.audit.run(ctx, { throughDate: asOfDate, scope: 'through' });
    const bounds = resolveInvestPeriodBounds(
      await this.ledger.listLedgerEvents(ctx, '2000-01-01', asOfDate)
    );
    const stored = await this.patrimonyStore.loadRange(ctx, bounds.periodMin, asOfDate);

    return {
      horizonTrustedThrough: horizon,
      patrimonySeries: stored.map((s) => ({
        date: s.snapshot_date,
        patrimony: s.patrimony,
        source: s.source,
      })),
      audit,
      openIssues: audit.pendingDecisions,
    };
  }

  private async buildDayPreview(ctx: UserContext, sessionId: string, businessDate: string) {
    const runtime = this.requireRuntime(sessionId);
    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, businessDate, today);
    const ledgerTrades = events.filter((e) => tradeOnDate(e, businessDate) && isPatrimonyTrade(e));
    const fileRows = runtime.noteLinesByDate[businessDate] ?? [];

    const rows: DayPreviewRow[] = [];
    const matchedLedger = new Set<string>();
    const matchedFile = new Set<string>();

    for (const file of fileRows) {
      const hit = ledgerTrades.find((l) => !matchedLedger.has(l.id || '') && matchTrade(file, l));
      if (hit?.id) {
        matchedLedger.add(hit.id);
        matchedFile.add(file.rowKey);
        rows.push({
          rowKey: ledgerRowKey(hit),
          status: 'matched',
          source: 'ledger',
          ticker: hit.asset_ticker,
          quantity: hit.quantity,
          unitPrice: hit.unit_price,
          ledgerEntryId: hit.id,
          noteNumber: file.noteNumber,
        });
      }
    }

    for (const file of fileRows) {
      if (matchedFile.has(file.rowKey)) continue;
      rows.push({
        rowKey: file.rowKey,
        status: 'file_only',
        source: 'file',
        ticker: file.ticker,
        quantity: file.quantity,
        unitPrice: file.unitPrice,
        noteNumber: file.noteNumber,
      });
    }

    for (const leg of ledgerTrades) {
      if (leg.id && matchedLedger.has(leg.id)) continue;
      rows.push({
        rowKey: ledgerRowKey(leg),
        status: 'ledger_only',
        source: 'ledger',
        ticker: leg.asset_ticker,
        quantity: leg.quantity,
        unitPrice: leg.unit_price,
        amount: leg.total_net_value,
        ledgerEntryId: leg.id,
      });
    }

    const review = buildBrokerageNoteReviewRows(events, today).filter(
      (r) => r.pregaoDate === businessDate
    );
    void review;

    const pendingDecisions = rows
      .filter((r) => r.status !== 'matched' && !(r.status === 'skipped' && r.skipConfirmed))
      .map(previewRowToDecision);

    return { date: businessDate, rows, pendingDecisions };
  }

  private mergePendingDecisions(
    sessionId: string,
    businessDate: string,
    preview: { pendingDecisions: ReconcileDecision[] },
    auditPending: ReconcileDecision[]
  ): ReconcileDecision[] {
    const runtime = runtimeBySession.get(sessionId);
    const resolved = runtime?.resolvedByDay.get(businessDate) ?? new Map();
    const merged = [...preview.pendingDecisions, ...auditPending];
    const seen = new Set<string>();
    const out: ReconcileDecision[] = [];
    for (const d of merged) {
      if (resolved.has(d.decisionId)) continue;
      if (seen.has(d.decisionId)) continue;
      seen.add(d.decisionId);
      out.push(d);
    }
    return out;
  }

  private evaluateCanClose(preview: { rows: DayPreviewRow[] }): boolean {
    return preview.rows.every(
      (r) => r.status === 'matched' || (r.status === 'skipped' && r.skipConfirmed)
    );
  }

  private async materializeThroughDate(ctx: UserContext, throughDate: string) {
    await this.dailyClose.materializeDay(ctx, throughDate);
  }

  private async requireSession(ctx: UserContext, sessionId: string) {
    const session = await this.store.getById(ctx, sessionId);
    if (!session) {
      throw new GatewayError('RECORD_NOT_FOUND', 'Sessão não encontrada.', 404);
    }
    return session;
  }

  private requireRuntime(sessionId: string): SessionRuntime {
    const rt = runtimeBySession.get(sessionId);
    if (!rt) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'Sessão expirada na memória do servidor — reinicie com os mesmos arquivos.',
        400
      );
    }
    return rt;
  }

  private async assertNotesPhaseComplete(ctx: UserContext) {
    const rows = await this.gateway.findWhere(
      ctx,
      'invest_reconciliation_sessions',
      { phase: 'notes', status: 'notes_complete' },
      { limit: 1 }
    );
    if (!rows.length) {
      throw new GatewayError(
        'ACCESS_DENIED',
        'Conclua a fase de notas antes do extrato.',
        403
      );
    }
  }
}
