import { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { CoCeoDataGateway } from '../core/dal';
import { GatewayError } from '../core/dal/errors';
import { HoldingPurgeKeepOpeningService } from '../core/invest/HoldingPurgeKeepOpeningService';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { OpeningBalanceMigrationService } from '../core/invest/OpeningBalanceMigrationService';
import { PatrimonyDailyRebuildService } from '../core/invest/PatrimonyDailyRebuildService';
import { DailyCloseMaterializeService } from '../core/invest/reconcile/DailyCloseMaterializeService';
import { OptionCDailyCloseOrchestrator } from '../core/invest/reconcile/OptionCDailyCloseOrchestrator';
import { ReconciliationDiagnosticsService } from '../core/invest/reconcile/ReconciliationDiagnosticsService';
import { PatrimonyMonthlyAnchorsSeedService } from '../core/invest/PatrimonyMonthlyAnchorsSeedService';
import { PatrimonyMonthlyAnchorsRepository } from '../core/invest/PatrimonyMonthlyAnchorsRepository';
import { logReconcileEvent, logReconcileFailure } from '../core/invest/reconcile/reconcileErrorDetail';

export class ReconcileController {
  private readonly holdingPurge: HoldingPurgeKeepOpeningService;
  private readonly openingMigration: OpeningBalanceMigrationService;
  private readonly ledger: LedgerImportService;
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly dailyClose: DailyCloseMaterializeService;
  private readonly optionC: OptionCDailyCloseOrchestrator;
  private readonly diagnostics: ReconciliationDiagnosticsService;
  private readonly anchorSeed: PatrimonyMonthlyAnchorsSeedService;
  private readonly anchorsRepo: PatrimonyMonthlyAnchorsRepository;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    pool: Pool
  ) {
    this.holdingPurge = new HoldingPurgeKeepOpeningService(gateway, pool);
    this.openingMigration = new OpeningBalanceMigrationService(gateway);
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.dailyClose = new DailyCloseMaterializeService(gateway);
    this.optionC = new OptionCDailyCloseOrchestrator(gateway, pool);
    this.diagnostics = new ReconciliationDiagnosticsService(gateway);
    this.anchorSeed = new PatrimonyMonthlyAnchorsSeedService(gateway);
    this.anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  }

  /**
   * POST /api/invest/reconcile/reset-holding
   *
   * Purge canônico (HoldingPurgeKeepOpeningService): preserva abertura OPENING + pernas
   * opening_balance, zera odômetro, reconcilia custódia.
   */
  resetHolding = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({
          success: false,
          error: 'Selecione a holding (personifique o titular) antes de executar o reset.',
        });
      }

      console.log(`[ReconcileReset] Purge canônico org=${orgId} user=${ctx.userId}`);

      const result = await this.holdingPurge.purgeKeepOpening(ctx);

      return res.json({
        success: true,
        message:
          'Reset concluído. Abertura preservada. Importe primeiro as NOTAS, depois os EXTRATOS.',
        report: {
          openingDate: result.openingDate,
          openingRef: result.openingRef,
          openingLegCount: result.openingLegCount,
          patrimonyLegsRemoved: result.patrimonyLegsRemoved,
          financialLegsRemoved: result.financialLegsRemoved,
          businessEventsRemoved: result.businessEventsRemoved,
          auxRowsRemoved: result.auxRowsToRemove,
          storageBytesBefore: result.storageBytesBefore,
          activityLog: result.activityLog,
          reconcileCustody: result.reconcileCustody,
        },
      });
    } catch (error: unknown) {
      const detail = logReconcileFailure('reset-holding', orgId ?? undefined, error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  /** POST /api/invest/reconcile/migrate-opening-balance */
  migrateOpeningBalance = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }

      const report = await this.openingMigration.migrate(ctx);
      const hasBlocked = report.blocked.length > 0;
      return res.status(hasBlocked ? 409 : 200).json({
        success: !hasBlocked,
        message: hasBlocked
          ? `Migracao parcial: ${report.blocked.length} conta(s) bloqueada(s).`
          : `Migracao concluida: ${report.legsCreated} perna(s) criada(s), ${report.zeroed} conta(s) zerada(s).`,
        report,
      });
    } catch (error: unknown) {
      const detail = logReconcileFailure('migrate-opening-balance', orgId ?? undefined, error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  /**
   * POST /api/invest/reconcile/recalc-all
   *
   * Materialização canônica pós-importação:
   * 1. reconcileCustody
   * 2. três preços + invest_position_ext
   * 3. PatrimonyDailyRebuildService (invest_portfolio_daily, mtm_economic)
   */
  recalcAll = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({
          success: false,
          error: 'Selecione a holding antes de recalcular.',
        });
      }

      console.log(`[ReconcileRecalc] Materialização completa org=${orgId}`);

      const custody = await this.ledger.reconcileCustody(ctx);

      const today = new Date().toISOString().slice(0, 10);
      const { positionsUpdated, positionsZeroed } =
        await this.dailyClose.recalcThreePricesPublic(ctx, today);

      const from = req.body?.from ? String(req.body.from).slice(0, 10) : undefined;
      const to = req.body?.to ? String(req.body.to).slice(0, 10) : undefined;
      const rebuild = await this.patrimonyRebuild.rebuild(ctx, { from, to });

      return res.json({
        success: true,
        message:
          'Recálculo concluído. Confira o gráfico em Resultado histórico e a carteira em Ações/FIIs.',
        custody,
        positions: { positionsUpdated, positionsZeroed },
        patrimonyRebuild: rebuild,
      });
    } catch (error: unknown) {
      const detail = logReconcileFailure('recalc-all', orgId ?? undefined, error);
      return res.status(500).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  /** GET /api/invest/reconcile/diagnostics - batimento individual de ativos, eventos e caixa */
  diagnosticsReport = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }
      const asOf = req.query.asOf ? String(req.query.asOf).slice(0, 10) : undefined;
      const report = await this.diagnostics.build(ctx, asOf);
      return res.json(report);
    } catch (error: unknown) {
      const detail = logReconcileFailure('diagnostics', orgId ?? undefined, error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  diagnosticsFinancial = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }
      const asOf = req.query.to
        ? String(req.query.to).slice(0, 10)
        : req.query.asOf
        ? String(req.query.asOf).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const from = req.query.from ? String(req.query.from).slice(0, 10) : '1900-01-01';
      const rows = await this.diagnostics.getFinancialDiagnostics(ctx, from, asOf);
      return res.json({ success: true, from, to: asOf, rows });
    } catch (error: unknown) {
      const detail = logReconcileFailure('diagnostics.financial', orgId ?? undefined, error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({ success: false, error: detail.message, errorDetail: detail });
    }
  };

  diagnosticsEvents = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }
      const asOf = req.query.to
        ? String(req.query.to).slice(0, 10)
        : req.query.asOf
        ? String(req.query.asOf).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const from = req.query.from ? String(req.query.from).slice(0, 10) : '1900-01-01';
      const rows = await this.diagnostics.getEventsDiagnostics(ctx, from, asOf);
      return res.json({ success: true, from, to: asOf, rows });
    } catch (error: unknown) {
      const detail = logReconcileFailure('diagnostics.events', orgId ?? undefined, error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({ success: false, error: detail.message, errorDetail: detail });
    }
  };

  diagnosticsPortfolio = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }
      const asOf = req.query.to
        ? String(req.query.to).slice(0, 10)
        : req.query.asOf
        ? String(req.query.asOf).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const from = req.query.from ? String(req.query.from).slice(0, 10) : '1900-01-01';
      const rows = await this.diagnostics.getPortfolioDiagnostics(ctx, from, asOf);
      return res.json({ success: true, from, to: asOf, rows });
    } catch (error: unknown) {
      const detail = logReconcileFailure('diagnostics.portfolio', orgId ?? undefined, error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({ success: false, error: detail.message, errorDetail: detail });
    }
  };

  /** POST /api/invest/reconcile/option-c/start — Opção C: reset + 2 pastas + calendário de pregões */
  optionCStart = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }
      const notesFiles = Array.isArray(req.body?.notesFiles) ? req.body.notesFiles : [];
      const extractFiles = Array.isArray(req.body?.extractFiles) ? req.body.extractFiles : [];
      const homeBrokerFiles = Array.isArray(req.body?.homeBrokerFiles) ? req.body.homeBrokerFiles : [];
      const resetFirst = req.body?.resetFirst === true;
      const dataMode = req.body?.dataMode as 'recover' | 'reset_from_opening' | undefined;
      const mode = req.body?.mode === 'strict' ? 'strict' : 'homologation';

      console.log(
        `[OptionC] start org=${orgId} mode=${mode} resetFirst=${resetFirst} notas=${notesFiles.length} extratos=${extractFiles.length} homeBroker=${homeBrokerFiles.length}`
      );
      logReconcileEvent('info', 'api.option-c.start.request', orgId, {
        mode,
        resetFirst,
        notesFiles: notesFiles.length,
        extractFiles: extractFiles.length,
        homeBrokerFiles: homeBrokerFiles.length,
      });

      const existingAnchors = await this.anchorsRepo.loadForOrganization(ctx);
      let anchorsSeeded = false;
      if (existingAnchors.month_ends.length === 0 && this.anchorSeed.resolveReference(ctx)) {
        console.log(`[OptionC] org=${orgId} gravando âncoras BTG (tabela vazia)`);
        await this.anchorSeed.seedFromHomebrokerReference(ctx);
        anchorsSeeded = true;
      }

      const state = await this.optionC.start(ctx, {
        notesFiles,
        extractFiles,
        homeBrokerFiles,
        resetFirst,
        dataMode,
        mode,
      });
      logReconcileEvent('info', 'api.option-c.start.response', orgId, {
        runId: state.runId,
        sessionId: state.sessionId,
        calendarDays: state.calendar.length,
        homeBrokerWarnings: state.homeBrokerImport?.warnings.length ?? 0,
        schemaApplied: state.schemaApplied === true,
      });
      console.log(
        `[OptionC] org=${orgId} iniciado runId=${state.runId} pregões=${state.calendar.length}`
      );
      return res.json({
        success: true,
        message:
          mode === 'homologation'
            ? 'Homologação iniciada. O sistema avança dia a dia, grava patrimônio e registra divergências como avisos.'
            : 'Opção C iniciada. Use option-c/next-day para fechar cada pregão (cotações web + patrimônio gravado).',
        anchorsSeeded,
        schemaApplied: state.schemaApplied === true,
        state,
      });
    } catch (error: unknown) {
      const detail = logReconcileFailure('option-c.start', orgId ?? undefined, error, {
        resetFirst: req.body?.resetFirst === true,
        notesFiles: Array.isArray(req.body?.notesFiles) ? req.body.notesFiles.length : 0,
        extractFiles: Array.isArray(req.body?.extractFiles) ? req.body.extractFiles.length : 0,
        homeBrokerFiles: Array.isArray(req.body?.homeBrokerFiles) ? req.body.homeBrokerFiles.length : 0,
      });
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  /** POST /api/invest/reconcile/option-c/next-day — fecha o próximo pregão ou avança fase extratos */
  optionCNextDay = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const runId = String(req.body?.runId || '');
    try {
      if (!runId) {
        return res.status(400).json({ success: false, error: 'runId obrigatório.' });
      }
      logReconcileEvent('info', 'api.option-c.next-day.request', ctx.organizationId ?? undefined, {
        runId,
      });
      const result = await this.optionC.closeNextDay(ctx, runId);
      logReconcileEvent('info', 'api.option-c.next-day.response', ctx.organizationId ?? undefined, {
        runId,
        status: result.status,
        phase: result.state.phase,
        day: result.day ?? null,
        dayIndex: result.state.dayIndex,
        calendarDays: result.state.calendar.length,
      });
      return res.json({ success: true, ...result });
    } catch (error: unknown) {
      const detail = logReconcileFailure('option-c.next-day', ctx.organizationId ?? undefined, error, {
        runId,
      });
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  /**
   * POST /api/invest/reconcile/option-c/run-all
   *
   * Loop completo da Opção C no servidor (responde ao terminar ou bloquear).
   */
  optionCRunAll = async (req: Request, res: Response): Promise<Response> => {
    const ctx = req.userContext!;
    const orgId = ctx.organizationId;
    try {
      if (!orgId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }

      const notesFiles = Array.isArray(req.body?.notesFiles) ? req.body.notesFiles : [];
      const extractFiles = Array.isArray(req.body?.extractFiles) ? req.body.extractFiles : [];
      const homeBrokerFiles = Array.isArray(req.body?.homeBrokerFiles) ? req.body.homeBrokerFiles : [];
      const resetFirst = req.body?.resetFirst === true;
      const dataMode = req.body?.dataMode as 'recover' | 'reset_from_opening' | undefined;
      const mode = req.body?.mode === 'strict' ? 'strict' : 'homologation';
      const delayMs = req.body?.delayMs != null ? Number(req.body.delayMs) : 1200;

      if (!notesFiles.length) {
        return res.status(400).json({ success: false, error: 'Envie ao menos um arquivo de notas.' });
      }
      if (!extractFiles.length) {
        return res.status(400).json({ success: false, error: 'Envie ao menos um arquivo de extrato.' });
      }

      req.socket.setTimeout(0);
      res.setTimeout(0);

      console.log(
        `[OptionC/run-all] org=${orgId} mode=${mode} notas=${notesFiles.length} extratos=${extractFiles.length} homeBroker=${homeBrokerFiles.length} delay=${delayMs}ms`
      );
      logReconcileEvent('info', 'api.option-c.run-all.request', orgId, {
        mode,
        resetFirst,
        notesFiles: notesFiles.length,
        extractFiles: extractFiles.length,
        homeBrokerFiles: homeBrokerFiles.length,
        delayMs,
      });

      const existingAnchors = await this.anchorsRepo.loadForOrganization(ctx);
      if (existingAnchors.month_ends.length === 0 && this.anchorSeed.resolveReference(ctx)) {
        await this.anchorSeed.seedFromHomebrokerReference(ctx);
        console.log(`[OptionC/run-all] org=${orgId} âncoras BTG gravadas`);
      }

      if (req.body?.async === true) {
        const started = await this.optionC.start(ctx, {
          notesFiles,
          extractFiles,
          homeBrokerFiles,
          resetFirst,
          dataMode,
          mode,
        });
        started.runStatus = 'running';
        started.runError = null;
        const runId = started.runId;
        logReconcileEvent('info', 'api.option-c.run-all.accepted', orgId, {
          runId,
          calendarDays: started.calendar.length,
        });

        void (async () => {
          try {
            let iterations = 0;
            const maxIterations = started.calendar.length + 10;
            while (iterations < maxIterations) {
              iterations += 1;
              const current = this.optionC.getRun(runId);
              if (!current || current.phase === 'done') break;
              const result = await this.optionC.closeNextDay(ctx, runId);
              const state = result.state;
              state.runStatus = state.phase === 'done' ? 'done' : 'running';
              if (state.lastDay) {
                console.log(
                  `[OptionC/run-all/bg] org=${orgId} runId=${runId} dia=${state.lastDay} ` +
                    `(${state.dayIndex}/${state.calendar.length}) fase=${state.phase}`
                );
              }
              // Persiste progresso a cada pregão
              await this.optionC.getRunWithFallback(runId); // atualiza cache
              if (result.status === 'blocked' && state.mode !== 'homologation') break;
              if (result.status === 'done') break;
              if (delayMs > 0 && result.status !== 'phase_complete') {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
            }
            const finalState = this.optionC.getRun(runId);
            if (finalState) finalState.runStatus = finalState.phase === 'done' ? 'done' : 'running';
          } catch (error) {
            const current = this.optionC.getRun(runId);
            const message = error instanceof Error ? error.message : String(error);
            if (current) {
              current.runStatus = 'error';
              current.runError = message;
            }
            logReconcileFailure('option-c.run-all.background', orgId, error, { runId });
          }
        })();

        return res.status(202).json({
          success: true,
          accepted: true,
          message: 'Processamento iniciado em segundo plano. Acompanhe pelo status da execuÃ§Ã£o.',
          state: started,
        });
      }

      const finalState = await this.optionC.runAll(
        ctx,
        { notesFiles, extractFiles, homeBrokerFiles, resetFirst, dataMode, mode, delayMs },
        (state) => {
          if (state.lastDay) {
            console.log(
              `[OptionC/run-all] org=${orgId} dia=${state.lastDay} ` +
                `(${state.dayIndex}/${state.calendar.length}) fase=${state.phase}`
            );
          }
        }
      );

      const blocked = finalState.phase !== 'done';
      logReconcileEvent(blocked ? 'warn' : 'info', 'api.option-c.run-all.response', orgId, {
        runId: finalState.runId,
        phase: finalState.phase,
        dayIndex: finalState.dayIndex,
        calendarDays: finalState.calendar.length,
        lastDay: finalState.lastDay,
        blocked,
      });
      return res.json({
        success: mode === 'homologation' ? true : !blocked,
        message: blocked
          ? mode === 'homologation'
            ? 'Homologação avançou com avisos. Confira o log da Opção C.'
            : `Processo pausado — pendência no pregão ${finalState.lastDay ?? '?'}. Resolva na UI e use option-c/next-day para continuar.`
          : 'Importação completa. Confira Resultado histórico e Ações/FIIs.',
        state: finalState,
      });
    } catch (error: unknown) {
      const detail = logReconcileFailure('option-c.run-all', orgId ?? undefined, error, {
        resetFirst: req.body?.resetFirst === true,
        notesFiles: Array.isArray(req.body?.notesFiles) ? req.body.notesFiles.length : 0,
        extractFiles: Array.isArray(req.body?.extractFiles) ? req.body.extractFiles.length : 0,
        homeBrokerFiles: Array.isArray(req.body?.homeBrokerFiles) ? req.body.homeBrokerFiles.length : 0,
      });
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      return res.status(status).json({
        success: false,
        error: detail.message,
        errorDetail: detail,
      });
    }
  };

  /** GET /api/invest/reconcile/option-c/status/:runId */
  optionCStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      // Tenta na memória primeiro; se não encontrar, busca no DB (sobrevive a restart)
      const state = await this.optionC.getRunWithFallback(String(req.params.runId));
      if (!state) {
        return res.status(404).json({ success: false, error: 'Execução não encontrada.' });
      }
      return res.json({ success: true, state });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao consultar status.';
      return res.status(500).json({ success: false, error: message });
    }
  };

  /** POST /api/invest/reconcile/patrimony-anchors/seed-btg — grava âncoras homebroker (sem migration SQL) */
  seedBtgPatrimonyAnchors = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ctx = req.userContext!;
      if (!ctx.organizationId) {
        return res.status(400).json({ success: false, error: 'Personifique a holding.' });
      }
      const result = await this.anchorSeed.seedFromHomebrokerReference(ctx);
      const loaded = await this.anchorsRepo.loadForOrganization(ctx);
      return res.json({
        success: true,
        message: `${result.upserted} âncora(s) BTG gravada(s) — calibração ativa no fechamento diário.`,
        seed: result,
        anchors: loaded,
      });
    } catch (error: unknown) {
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      const message = error instanceof Error ? error.message : 'Falha ao gravar âncoras BTG.';
      return res.status(status).json({ success: false, error: message });
    }
  };

  /** GET /api/invest/reconcile/patrimony-anchors — lista âncoras da org */
  listPatrimonyAnchors = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ctx = req.userContext!;
      const anchors = await this.anchorsRepo.loadForOrganization(ctx);
      return res.json({ success: true, anchors });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao listar âncoras.';
      return res.status(500).json({ success: false, error: message });
    }
  };
}
