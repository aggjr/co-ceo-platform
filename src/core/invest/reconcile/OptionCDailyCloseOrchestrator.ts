import type { Pool } from 'mysql2/promise';
import type { CoCeoDataGateway, UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import type { BtgUploadFileInput } from '../btgUploadImportService';
import { applyBtgExtractBatchUpload } from '../btgUploadImportService';
import { LedgerImportService } from '../LedgerImportService';
import { HoldingPurgeKeepOpeningService } from '../HoldingPurgeKeepOpeningService';
import { PatrimonyDailyRebuildService } from '../PatrimonyDailyRebuildService';
import { ReconciliationSessionService } from './ReconciliationSessionService';
import { DailyCloseMaterializeService } from './DailyCloseMaterializeService';
import { buildNotesFileIndex } from './reconcileNotesIndex';
import {
  HomeBrokerSnapshotUploadService,
  type HomeBrokerSnapshotUploadResult,
} from './HomeBrokerSnapshotUploadService';
import { logReconcileEvent, logReconcileFailure } from './reconcileErrorDetail';
import type { ReconcileDecision } from './auditTypes';
import type { LedgerImportLine } from '../ledgerTypes';

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
  linesByDate: Map<string, LedgerImportLine[]>;
};

const runsById = new Map<string, OptionCRuntime>();

function newRunId(orgId: string): string {
  return `optc-${orgId}-${Date.now().toString(36)}`;
}

function logStep(rt: OptionCRuntime, message: string): void {
  rt.state.activityLog.push(message);
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
 * Opção C — reset + 2 pastas + fechamento calmo dia a dia com cotações web e materialização.
 */
export class OptionCDailyCloseOrchestrator {
  private readonly session: ReconciliationSessionService;
  private readonly dailyClose: DailyCloseMaterializeService;
  private readonly ledger: LedgerImportService;
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly homeBrokerUpload: HomeBrokerSnapshotUploadService;
  private readonly holdingPurge: HoldingPurgeKeepOpeningService | null;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    pool?: Pool
  ) {
    this.session = new ReconciliationSessionService(gateway, pool);
    this.dailyClose = new DailyCloseMaterializeService(gateway);
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.homeBrokerUpload = new HomeBrokerSnapshotUploadService(gateway);
    this.holdingPurge = pool ? new HoldingPurgeKeepOpeningService(gateway, pool) : null;
  }

  getRun(runId: string): OptionCRunState | null {
    return runsById.get(runId)?.state ?? null;
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

    if (input.resetFirst && this.holdingPurge) {
      logReconcileEvent('info', 'option-c.reset.start', ctx.organizationId, {
        mode,
        notesFiles: input.notesFiles.length,
        extractFiles: input.extractFiles.length,
        homeBrokerFiles: input.homeBrokerFiles?.length ?? 0,
      });
      console.log(`[OptionC] org=${ctx.organizationId} reset (purge) antes da sessão de notas…`);
      try {
        await this.holdingPurge.purgeKeepOpening(ctx);
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

    const sessionDataMode =
      input.resetFirst &&
      (input.dataMode === 'reset_from_opening' || input.dataMode === undefined)
        ? undefined
        : input.dataMode;

    const started = await this.session.startSession(ctx, {
      phase: 'notes',
      files: input.notesFiles,
      dataMode: sessionDataMode,
    });

    const index = await buildNotesFileIndex(input.notesFiles);
    const linesByDate = new Map<string, LedgerImportLine[]>();
    for (const [, line] of index.linesByRowKey) {
      const d = String(line.date || '').slice(0, 10);
      if (!d) continue;
      const list = linesByDate.get(d) ?? [];
      list.push(line);
      linesByDate.set(d, list);
    }

    const runId = newRunId(ctx.organizationId);
    const rt: OptionCRuntime = {
      notesFiles: input.notesFiles,
      extractFiles: input.extractFiles,
      linesByDate,
      state: {
        runId,
        organizationId: ctx.organizationId,
        sessionId: started.sessionId,
        phase: 'notes',
        calendar: started.calendar ?? [],
        dayIndex: 0,
        horizonTrustedThrough: null,
        notesFilesCount: input.notesFiles.length,
        extractFilesCount: input.extractFiles.length,
        homeBrokerFilesCount: input.homeBrokerFiles?.length ?? 0,
        mode,
        extractPending: true,
        lastDay: null,
        activityLog: [...(started.activityLog?.map((s) => s.message) ?? [])],
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
      `Opção C iniciada (${mode}) — ${rt.state.calendar.length} pregão(ões) de notas, ${input.extractFiles.length} extrato(s) na fase 2.`
    );
    runsById.set(runId, rt);
    return rt.state;
  }

  async closeNextDay(ctx: UserContext, runId: string): Promise<{
    status: 'closed' | 'blocked' | 'phase_complete' | 'done';
    day?: string;
    materialize?: Awaited<ReturnType<DailyCloseMaterializeService['materializeDay']>>;
    pendingDecisions?: ReconcileDecision[];
    blockReasons?: string[];
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
      return this.closeNextNotesDay(ctx, rt);
    }

    if (rt.state.phase === 'extracts') {
      return this.finishExtractsPhase(ctx, rt);
    }

    return { status: 'done', state: rt.state };
  }

  /**
   * Executa o loop completo da Opção C no servidor:
   * inicia sessão → fecha cada pregão com delay → importa extratos → rebuild.
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
    logStep(runsById.get(runId)!, `run-all iniciado — ${state.calendar.length} pregão(ões), delay=${delay}ms`);

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

  private async closeNextNotesDay(ctx: UserContext, rt: OptionCRuntime) {
    const { calendar, dayIndex, sessionId } = rt.state;
    if (dayIndex >= calendar.length) {
      logStep(rt, 'Fase notas concluída — iniciando extratos.');
      await this.session.completePhase(ctx, sessionId);
      rt.state.phase = 'extracts';
      return this.finishExtractsPhase(ctx, rt);
    }

    const day = calendar[dayIndex]!;
    logStep(rt, `─── Pregão ${day} (${dayIndex + 1}/${calendar.length}) ───`);

    await this.ledger.reconcileCustody(ctx);

    const dayLines = rt.linesByDate.get(day) ?? [];
    if (dayLines.length) {
      const imported = await this.ledger.importEntriesOnly(ctx, dayLines, {
        sourceLabel: 'option_c_notes_day',
      });
      logStep(
        rt,
        `Notas ${day}: ${imported.inserted} gravada(s), ${imported.skipped} pulada(s).`
      );
    }

    const dayState = await this.session.getDay(ctx, sessionId, day);
    if (!dayState.canClose && rt.state.mode !== 'homologation') {
      logStep(
        rt,
        `Bloqueado em ${day}: ${dayState.pendingDecisions.length} pendência(s) — resolva na UI.`
      );
      return {
        status: 'blocked' as const,
        day,
        pendingDecisions: dayState.pendingDecisions,
        blockReasons: dayState.blockReasons,
        state: rt.state,
      };
    }

    if (!dayState.canClose && rt.state.mode === 'homologation') {
      logStep(
        rt,
        `Homologação ${day}: ${dayState.pendingDecisions.length} pendência(s) registrada(s); avanço mantido.`
      );
    }

    logStep(rt, `Fechando ${day}: cotações web + patrimônio + 3 preços…`);
    const materialize =
      rt.state.mode === 'homologation'
        ? await this.dailyClose.materializeDay(ctx, day)
        : undefined;
    if (rt.state.mode !== 'homologation') {
      await this.session.closeDay(ctx, sessionId, day);
    }

    rt.state.dayIndex += 1;
    rt.state.horizonTrustedThrough = day;
    rt.state.lastDay = day;
    logStep(rt, `✅ Dia ${day} fechado.`);

    if (rt.state.dayIndex >= calendar.length) {
      logStep(rt, 'Calendário de notas esgotado — fase extratos.');
      await this.session.completePhase(ctx, sessionId);
      rt.state.phase = 'extracts';
      return {
        status: 'phase_complete' as const,
        day,
        state: rt.state,
      };
    }

    return {
      status: 'closed' as const,
      day,
      materialize,
      pendingDecisions: dayState.pendingDecisions,
      state: rt.state,
    };
  }

  private async finishExtractsPhase(ctx: UserContext, rt: OptionCRuntime) {
    logStep(rt, `Importando ${rt.extractFiles.length} extrato(s) BTG…`);

    const applied = await applyBtgExtractBatchUpload(ctx, this.ledger, rt.extractFiles);
    const fileResults = applied.fileResults ?? [];
    const importErrors = fileResults.filter((f: { importOk?: boolean }) => f.importOk === false).length;
    logReconcileEvent(importErrors ? 'warn' : 'info', 'option-c.extracts.done', rt.state.organizationId, {
      runId: rt.state.runId,
      files: fileResults.length,
      importErrors,
      inserted: applied.totals?.inserted ?? 0,
      skipped: applied.totals?.skipped ?? 0,
      chainOk: applied.chainOk,
      blockedMessage: applied.blockedMessage ?? null,
    });

    if (importErrors > 0) {
      logStep(rt, `⚠️ ${importErrors} extrato(s) com erro — divergência registrada.`);
      if (rt.state.mode !== 'homologation') {
        return {
          status: 'blocked' as const,
          blockReasons: ['invest.reconcile.block.extract_import'],
          state: rt.state,
        };
      }
      logStep(rt, 'Homologação: seguindo para rebuild mesmo com erro em extrato.');
    }

    logStep(rt, 'Rebuild patrimônio diário (intervalo completo)…');
    const rebuild = await this.patrimonyRebuild.rebuild(ctx);
    logStep(
      rt,
      `Rebuild: ${rebuild.daysWritten} dia(s) gravados, ${rebuild.daysSkipped} pulados.`
    );

    rt.state.phase = 'done';
    rt.state.extractPending = false;
    logStep(rt, '🎉 Opção C concluída. Confira Resultado histórico e Ações/FIIs.');

    return {
      status: 'done' as const,
      state: rt.state,
    };
  }
}
