import type { Pool } from 'mysql2/promise';
import type { CoCeoDataGateway, UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import type { BtgUploadFileInput } from '../btgUploadImportService';
import {
  applyBtgMonthImport,
  buildMonthReconcileLedger,
  discoverMonthExtractPlan,
  filterLedgerOpeningOnly,
  monthBounds,
  type MonthExtractPlanEntry,
} from '../btgMonthImportService';
import type { LedgerEvent } from '../CustodyEngine';
import { InvestQuoteSyncService } from '../InvestQuoteSyncService';
import { OptionHistoricalSyncService } from '../OptionHistoricalSyncService';
import { LedgerImportService } from '../LedgerImportService';
import { HoldingPurgeKeepOpeningService } from '../HoldingPurgeKeepOpeningService';
import { PatrimonyDailyRebuildService } from '../PatrimonyDailyRebuildService';
import { ReconciliationSessionService } from './ReconciliationSessionService';
import { ReconciliationDiagnosticsService } from './ReconciliationDiagnosticsService';
import {
  HomeBrokerSnapshotUploadService,
  type HomeBrokerSnapshotUploadResult,
} from './HomeBrokerSnapshotUploadService';
import { logInvestStdout, logReconcileEvent, logReconcileFailure } from './reconcileErrorDetail';
import { OptionCRunRepository } from './OptionCRunRepository';
import type { ReconcileDecision } from './auditTypes';

export type OptionCPhase = 'notes' | 'extracts' | 'done';
export type OptionCMode = 'strict' | 'homologation';

export type OptionCRunState = {
  runId: string;
  organizationId: string;
  sessionId: string;
  phase: OptionCPhase;
  calendar: string[];
  dayIndex: number;
  horizonTrustedThrough: string | null;
  notesFilesCount: number;
  extractFilesCount: number;
  homeBrokerFilesCount: number;
  mode: OptionCMode;
  extractPending: boolean;
  lastDay: string | null;
  activityLog: string[];
  runStatus?: 'idle' | 'running' | 'done' | 'error';
  runError?: string | null;
  schemaApplied?: boolean;
  homeBrokerImport?: HomeBrokerSnapshotUploadResult;
};

type OptionCRuntime = {
  state: OptionCRunState;
  notesFiles: BtgUploadFileInput[];
  extractFiles: BtgUploadFileInput[];
  monthPlan: MonthExtractPlanEntry[];
  quotesSynced: boolean;
  previousClosingExtract: number | null;
  /** Livro simulado mês a mês (série de saldo do extrato) — mesma regra da prévia em lote. */
  workingLedger: LedgerEvent[];
  monthsApplied: string[];
  monthsSkipped: string[];
  resetFirst: boolean;
};

const runsById = new Map<string, OptionCRuntime>();

function newRunId(orgId: string): string {
  return `optc-${orgId}-${Date.now().toString(36)}`;
}

function logStep(rt: OptionCRuntime, message: string): void {
  rt.state.activityLog.push(message);
  logInvestStdout('OptionC', rt.state.organizationId, `run=${rt.state.runId} | ${message}`);
  logReconcileEvent('info', 'option-c.step', rt.state.organizationId, {
    runId: rt.state.runId,
    phase: rt.state.phase,
    dayIndex: rt.state.dayIndex,
    calendarDays: rt.state.calendar.length,
    lastDay: rt.state.lastDay,
    message,
  });
}

/**
 * Opção C — reset + pastas BTG + fechamento mês a mês (notas + extrato + patrimônio com âncoras).
 */
export class OptionCDailyCloseOrchestrator {
  private readonly session: ReconciliationSessionService;
  private readonly ledger: LedgerImportService;
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly homeBrokerUpload: HomeBrokerSnapshotUploadService;
  private readonly holdingPurge: HoldingPurgeKeepOpeningService | null;
  private readonly runRepo: OptionCRunRepository | null;
  private readonly diagnostics: ReconciliationDiagnosticsService;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    pool?: Pool
  ) {
    this.session = new ReconciliationSessionService(gateway, pool);
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.homeBrokerUpload = new HomeBrokerSnapshotUploadService(gateway);
    this.holdingPurge = pool ? new HoldingPurgeKeepOpeningService(gateway, pool) : null;
    this.runRepo = pool ? new OptionCRunRepository(pool) : null;
    this.diagnostics = new ReconciliationDiagnosticsService(gateway);
  }

  getRun(runId: string): OptionCRunState | null {
    return runsById.get(runId)?.state ?? null;
  }

  /**
   * Busca o run no cache em memória; se não encontrar, tenta restaurar do DB.
   * Retorna null se o run não existir em nenhuma das fontes.
   */
  async getRunWithFallback(runId: string): Promise<OptionCRunState | null> {
    const cached = runsById.get(runId)?.state;
    if (cached) return cached;
    if (!this.runRepo) return null;
    try {
      const persisted = await this.runRepo.findById(runId);
      if (persisted) {
        runsById.set(runId, {
          state: persisted,
          notesFiles: [],
          extractFiles: [],
          monthPlan: [],
          quotesSynced: false,
          previousClosingExtract: null,
          workingLedger: [],
          monthsApplied: [],
          monthsSkipped: [],
          resetFirst: false,
        });
      }
      return persisted;
    } catch {
      return null;
    }
  }

  async start(
    ctx: UserContext,
    input: {
      notesFiles: BtgUploadFileInput[];
      extractFiles: BtgUploadFileInput[];
      homeBrokerFiles?: BtgUploadFileInput[];
      resetFirst?: boolean;
      dataMode?: 'recover' | 'reset_from_opening';
      mode?: OptionCMode;
    }
  ): Promise<OptionCRunState> {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Personifique a holding antes de iniciar.', 400);
    }
    if (!input.notesFiles?.length) {
      throw new GatewayError('INVALID_PAYLOAD', 'Selecione a pasta de notas de corretagem.', 400);
    }
    if (!input.extractFiles?.length) {
      throw new GatewayError('INVALID_PAYLOAD', 'Selecione a pasta de extratos BTG.', 400);
    }

    const mode = input.mode ?? 'homologation';

    let purgeLog: string[] = [];
    if (input.resetFirst && this.holdingPurge) {
      logReconcileEvent('info', 'option-c.reset.start', ctx.organizationId, {
        mode,
        notesFiles: input.notesFiles.length,
        extractFiles: input.extractFiles.length,
        homeBrokerFiles: input.homeBrokerFiles?.length ?? 0,
      });
      console.log(`[OptionC] org=${ctx.organizationId} reset (purge) antes da sessão de notas…`);
      try {
        const purgeResult = await this.holdingPurge.purgeKeepOpening(ctx);
        purgeLog = purgeResult.activityLog?.map((s) => s.message) ?? [];
        logReconcileEvent('info', 'option-c.reset.done', ctx.organizationId, { mode });
        console.log(`[OptionC] org=${ctx.organizationId} reset concluído — abertura preservada.`);
      } catch (err) {
        logReconcileFailure('option-c.reset', ctx.organizationId, err, { mode });
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[OptionC] org=${ctx.organizationId} FALHA no reset: ${msg}`);
        throw err;
      }
    }

    const homeBrokerImport = await this.homeBrokerUpload.importAndApply(
      ctx,
      input.homeBrokerFiles
    );

    const monthPlan = await discoverMonthExtractPlan(input.extractFiles);
    if (!monthPlan.length) {
      throw new GatewayError(
        'INVALID_PAYLOAD',
        'Nenhum extrato BTG válido encontrado — confira os arquivos da pasta.',
        400
      );
    }

    const sessionDataMode =
      input.dataMode ??
      (input.resetFirst ? ('recover' as const) : undefined);

    const started = await this.session.startSession(ctx, {
      phase: 'notes',
      files: input.notesFiles,
      dataMode: sessionDataMode,
    });

    const runId = newRunId(ctx.organizationId);
    const monthCalendar = monthPlan.map((m) => m.month);
    const today = new Date().toISOString().slice(0, 10);
    const dbLedger = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const workingLedger = input.resetFirst
      ? filterLedgerOpeningOnly(dbLedger)
      : dbLedger;
    const rt: OptionCRuntime = {
      notesFiles: input.notesFiles,
      extractFiles: input.extractFiles,
      monthPlan,
      quotesSynced: false,
      previousClosingExtract: null,
      workingLedger,
      monthsApplied: [],
      monthsSkipped: [],
      resetFirst: input.resetFirst === true,
      state: {
        runId,
        organizationId: ctx.organizationId,
        sessionId: started.sessionId,
        phase: 'notes',
        calendar: monthCalendar,
        dayIndex: 0,
        horizonTrustedThrough: null,
        notesFilesCount: input.notesFiles.length,
        extractFilesCount: input.extractFiles.length,
        homeBrokerFilesCount: input.homeBrokerFiles?.length ?? 0,
        mode,
        extractPending: true,
        lastDay: null,
        activityLog: [...purgeLog, ...(started.activityLog?.map((s) => s.message) ?? [])],
        runStatus: 'idle',
        runError: null,
        schemaApplied: started.schemaApplied,
        homeBrokerImport,
      },
    };

    if (homeBrokerImport.filesTotal > 0) {
      logStep(
        rt,
        `Home broker: ${homeBrokerImport.snapshotsImported} snapshot(s), ${homeBrokerImport.anchorsUpserted} ancora(s), ${homeBrokerImport.warnings.length} aviso(s).`
      );
      for (const warning of homeBrokerImport.warnings) {
        logStep(rt, `Home broker aviso: ${warning}`);
      }
    }

    logStep(
      rt,
      `Opção C iniciada (${mode}) — ${monthCalendar.length} mês(es) de ${monthCalendar[0]} a ${monthCalendar[monthCalendar.length - 1]}, ${input.notesFiles.length} nota(s), ${input.extractFiles.length} extrato(s).`
    );
    runsById.set(runId, rt);

    if (this.runRepo) {
      try {
        await this.runRepo.upsert(rt.state);
        await this.runRepo.pruneOld();
      } catch (err) {
        logReconcileFailure('option-c.run-repo.upsert', ctx.organizationId, err, { runId });
      }
    }

    return rt.state;
  }

  async closeNextDay(ctx: UserContext, runId: string): Promise<{
    status: 'closed' | 'blocked' | 'phase_complete' | 'done';
    day?: string;
    materialize?: unknown;
    pendingDecisions?: ReconcileDecision[];
    blockReasons?: string[];
    message?: string;
    state: OptionCRunState;
  }> {
    const rt = runsById.get(runId);
    if (!rt || rt.state.organizationId !== ctx.organizationId) {
      throw new GatewayError('RECORD_NOT_FOUND', 'Execução Opção C não encontrada.', 404);
    }

    if (rt.state.phase === 'done') {
      return { status: 'done', state: rt.state };
    }

    if (rt.state.phase === 'notes') {
      return this.closeNextMonth(ctx, rt);
    }

    if (rt.state.phase === 'extracts') {
      return this.finalizeRun(ctx, rt);
    }

    return { status: 'done', state: rt.state };
  }

  /**
   * Executa o loop completo da Opção C no servidor:
   * inicia sessão → importa e fecha cada mês → rebuild com âncoras.
   */
  async runAll(
    ctx: UserContext,
    input: {
      notesFiles: BtgUploadFileInput[];
      extractFiles: BtgUploadFileInput[];
      homeBrokerFiles?: BtgUploadFileInput[];
      resetFirst?: boolean;
      dataMode?: 'recover' | 'reset_from_opening';
      mode?: OptionCMode;
      delayMs?: number;
    },
    onProgress?: (state: OptionCRunState) => void
  ): Promise<OptionCRunState> {
    const delay = input.delayMs ?? 1200;

    const state = await this.start(ctx, {
      notesFiles: input.notesFiles,
      extractFiles: input.extractFiles,
      homeBrokerFiles: input.homeBrokerFiles,
      resetFirst: input.resetFirst,
      dataMode: input.dataMode,
      mode: input.mode,
    });

    const runId = state.runId;
    logStep(runsById.get(runId)!, `run-all iniciado — ${state.calendar.length} mês(es), delay=${delay}ms`);

    let iterations = 0;
    const maxIterations = state.calendar.length + 10;

    while (iterations < maxIterations) {
      iterations++;
      const rt = runsById.get(runId);
      if (!rt || rt.state.phase === 'done') break;

      const result = await this.closeNextDay(ctx, runId);
      logReconcileEvent('info', 'option-c.run-all.iteration', ctx.organizationId ?? undefined, {
        runId,
        iteration: iterations,
        status: result.status,
        phase: result.state.phase,
        day: result.day ?? null,
        dayIndex: result.state.dayIndex,
        calendarDays: result.state.calendar.length,
      });
      onProgress?.(result.state);

      if (result.status === 'blocked' && rt.state.mode !== 'homologation') {
        logStep(
          rt,
          `run-all bloqueado em ${result.day ?? '?'} — pendências não resolvidas automaticamente.`
        );
        break;
      }

      if (result.status === 'done') break;

      if (delay > 0 && result.status !== 'phase_complete') {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const finalRt = runsById.get(runId);
    return finalRt?.state ?? state;
  }

  private async ensureHistoricalQuotes(ctx: UserContext, rt: OptionCRuntime): Promise<void> {
    if (rt.quotesSynced) return;
    logStep(rt, 'Baixando cotações históricas em lote (Brapi)...');
    if (this.runRepo) {
      try {
        await this.runRepo.upsert(rt.state);
      } catch {
        /* best-effort */
      }
    }
    try {
      const quoteSync = new InvestQuoteSyncService(this.gateway);
      const quotesFetched = await quoteSync.syncHistoricalFromBrapi(ctx);
      logStep(rt, `Cotações atualizadas: ${quotesFetched} registro(s) global(is).`);
    } catch (err) {
      logStep(
        rt,
        `⚠️ Falha ao baixar cotações Brapi: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    try {
      logStep(rt, 'Baixando cotações de opções pendentes...');
      const optionQuoteSync = new OptionHistoricalSyncService(this.gateway);
      await optionQuoteSync.syncMissingOptions(ctx);
      logStep(rt, 'Verificação de opções pendentes concluída.');
    } catch (err) {
      logStep(
        rt,
        `⚠️ Falha ao verificar opções pendentes: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    rt.quotesSynced = true;
  }

  private async closeNextMonth(ctx: UserContext, rt: OptionCRuntime) {
    const { calendar, dayIndex } = rt.state;
    if (dayIndex >= calendar.length) {
      logStep(rt, 'Todos os meses processados — finalizando.');
      rt.state.phase = 'extracts';
      return this.finalizeRun(ctx, rt);
    }

    const month = calendar[dayIndex]!;
    const planEntry = rt.monthPlan[dayIndex];
    if (!planEntry || planEntry.month !== month) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        `Plano mensal inconsistente para ${month}. Reinicie a Opção C.`,
        409
      );
    }

    logStep(rt, `─── Mês ${month} (${dayIndex + 1}/${calendar.length}) ───`);

    await this.ensureHistoricalQuotes(ctx, rt);
    await this.ledger.reconcileCustody(ctx);

    const importResult = await applyBtgMonthImport(
      ctx,
      this.ledger,
      month,
      planEntry.extractFile,
      rt.notesFiles,
      {
        previousClosingExtract: rt.previousClosingExtract,
        simulateFreshImport: rt.resetFirst,
        baseLedger: rt.workingLedger,
      }
    );

    logStep(
      rt,
      `Importação ${month}: notas ${importResult.notesOk ? 'OK' : 'pendente'} (${importResult.notesFilesInMonth} PDF(s)), caixa ${importResult.financialOk ? 'OK' : 'pendente'} — ${importResult.resultDetail}`
    );

    if (!importResult.applied) {
      const blockMsg =
        importResult.resultDetail ||
        importResult.extract.importError ||
        importResult.extract.parseError ||
        `Falha ao importar mês ${month}.`;
      logStep(rt, `⚠️ Mês ${month} não gravado: ${blockMsg}`);
      rt.monthsSkipped.push(month);
      if (rt.state.mode !== 'homologation') {
        rt.state.runStatus = 'error';
        rt.state.runError = blockMsg;
        return {
          status: 'blocked' as const,
          day: month,
          blockReasons: ['invest.reconcile.block.month_import'],
          message: blockMsg,
          state: rt.state,
        };
      }
      logStep(rt, `Homologação: avançando para o próximo mês sem gravar ${month}.`);
    } else {
      rt.monthsApplied.push(month);
      if (importResult.extract.closingExtract != null) {
        rt.previousClosingExtract = importResult.extract.closingExtract;
      }
      rt.workingLedger = await buildMonthReconcileLedger(
        month,
        planEntry.extractFile,
        rt.workingLedger
      );
      logStep(
        rt,
        `Gravado ${month}: notas +${importResult.notesInserted}/-${importResult.notesSkipped}, extrato +${importResult.extractInserted}/-${importResult.extractSkipped}.`
      );

      const bounds = monthBounds(month);
      if (!bounds) {
        logStep(rt, `⚠️ Mês inválido para rebuild: ${month}.`);
      } else {
        logStep(rt, `Rebuild patrimônio diário ${bounds.from} → ${bounds.to} (carga inicial + âncoras)…`);
        if (this.runRepo) {
          try {
            await this.runRepo.upsert(rt.state);
          } catch {
            /* best-effort */
          }
        }
        const rebuild = await this.patrimonyRebuild.rebuild(ctx, {
          from: bounds.from,
          to: bounds.to,
          initialLoad: true,
          onProgress: (daysWritten, daysSkipped, currentDay) => {
            logStep(
              rt,
              `Rebuild ${month}: dia ${currentDay} (${daysWritten + daysSkipped} processados).`
            );
            if (this.runRepo) {
              try {
                this.runRepo.upsert(rt.state);
              } catch {
                /* best-effort */
              }
            }
          },
        });
        logStep(
          rt,
          `Rebuild ${month}: ${rebuild.daysWritten} dia(s) gravados, ${rebuild.daysSkipped} pulados.`
        );
        rt.state.horizonTrustedThrough = bounds.to;
      }
    }

    rt.state.dayIndex += 1;
    rt.state.lastDay = month;
    logStep(rt, `✅ Mês ${month} fechado.`);

    if (rt.state.dayIndex >= calendar.length) {
      logStep(rt, 'Calendário mensal esgotado — finalizando.');
      rt.state.phase = 'extracts';
      return {
        status: 'phase_complete' as const,
        day: month,
        state: rt.state,
      };
    }

    return {
      status: 'closed' as const,
      day: month,
      state: rt.state,
    };
  }

  private async finalizeRun(ctx: UserContext, rt: OptionCRuntime) {
    await this.ensureHistoricalQuotes(ctx, rt);

    const firstMonth = rt.state.calendar[0];
    const lastMonth = rt.state.calendar[rt.state.calendar.length - 1];
    const fromBounds = firstMonth ? monthBounds(firstMonth) : null;
    const toBounds = lastMonth ? monthBounds(lastMonth) : null;

    if (fromBounds && toBounds) {
      logStep(
        rt,
        `Rebuild consolidado ${fromBounds.from} → ${toBounds.to} (validação final com âncoras)…`
      );
      if (this.runRepo) {
        try {
          await this.runRepo.upsert(rt.state);
        } catch {
          /* best-effort */
        }
      }
      const rebuild = await this.patrimonyRebuild.rebuild(ctx, {
        from: fromBounds.from,
        to: toBounds.to,
        initialLoad: true,
        onProgress: (daysWritten, daysSkipped, currentDay) => {
          logStep(
            rt,
            `Rebuild final: dia ${currentDay} (${daysWritten + daysSkipped} processados).`
          );
        },
      });
      logStep(
        rt,
        `Rebuild final: ${rebuild.daysWritten} dia(s) gravados, ${rebuild.daysSkipped} pulados.`
      );
      rt.state.horizonTrustedThrough = toBounds.to;
    }

    if (toBounds) {
      try {
        const report = await this.diagnostics.build(ctx, toBounds.to);
        const s = report.summary;
        logStep(
          rt,
          `Diagnóstico: ${s.eventErrors} evento(s) com erro, ${s.cashErrors} caixa, ${s.criticalFindings} achado(s) crítico(s).`
        );
        const eventSample = report.businessEvents
          .filter((r) => r.status === 'error')
          .slice(0, 3)
          .map((r) => `${r.date} ${r.tickers}: ${r.finding}`)
          .join('; ');
        if (eventSample) {
          logStep(rt, `Eventos com erro (amostra): ${eventSample}`);
        }
      } catch (e) {
        logReconcileFailure('option-c.diagnostics', ctx.organizationId ?? undefined, e);
      }
    }

    rt.state.phase = 'done';
    rt.state.extractPending = false;

    if (rt.monthsSkipped.length > 0) {
      rt.state.runStatus = 'error';
      rt.state.runError = `${rt.monthsSkipped.length} mês(es) não gravado(s): ${rt.monthsSkipped.join(', ')}`;
      logStep(
        rt,
        `❌ Importação incompleta — gravados: ${rt.monthsApplied.join(', ') || 'nenhum'}; pulados: ${rt.monthsSkipped.join(', ')}.`
      );
    } else {
      rt.state.runStatus = 'done';
      logStep(rt, '🎉 Opção C concluída. Confira Resultado histórico e Ações/FIIs.');
    }

    if (rt.monthsApplied.length > 0) {
      logStep(rt, `Meses gravados (${rt.monthsApplied.length}): ${rt.monthsApplied.join(', ')}.`);
    }

    if (this.runRepo) {
      try {
        await this.runRepo.upsert(rt.state);
      } catch {
        /* best-effort */
      }
    }

    return {
      status: 'done' as const,
      state: rt.state,
    };
  }
}
