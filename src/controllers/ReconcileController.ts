import { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { CoCeoDataGateway } from '../core/dal';
import { GatewayError } from '../core/dal/errors';
import { HoldingPurgeKeepOpeningService } from '../core/invest/HoldingPurgeKeepOpeningService';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { PatrimonyDailyRebuildService } from '../core/invest/PatrimonyDailyRebuildService';
import { RemoteRecalcController } from './RemoteRecalcController';
import { OptionCDailyCloseOrchestrator } from '../core/invest/reconcile/OptionCDailyCloseOrchestrator';
import { PatrimonyMonthlyAnchorsSeedService } from '../core/invest/PatrimonyMonthlyAnchorsSeedService';
import { PatrimonyMonthlyAnchorsRepository } from '../core/invest/PatrimonyMonthlyAnchorsRepository';
import { logReconcileFailure } from '../core/invest/reconcile/reconcileErrorDetail';

export class ReconcileController {
  private readonly holdingPurge: HoldingPurgeKeepOpeningService;
  private readonly ledger: LedgerImportService;
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly recalcController: RemoteRecalcController;
  private readonly optionC: OptionCDailyCloseOrchestrator;
  private readonly anchorSeed: PatrimonyMonthlyAnchorsSeedService;
  private readonly anchorsRepo: PatrimonyMonthlyAnchorsRepository;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    pool: Pool
  ) {
    this.holdingPurge = new HoldingPurgeKeepOpeningService(gateway, pool);
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.recalcController = new RemoteRecalcController(gateway);
    this.optionC = new OptionCDailyCloseOrchestrator(gateway, pool);
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

      const posResult = await new Promise<Record<string, unknown>>((resolve) => {
        void this.recalcController.recalcPositions(req, { json: resolve } as Response);
      });

      if (posResult.success === false) {
        return res.status(500).json({
          success: false,
          error: String(posResult.error || 'Falha ao recalcular posições.'),
          custody,
          positions: posResult,
        });
      }

      const from = req.body?.from ? String(req.body.from).slice(0, 10) : undefined;
      const to = req.body?.to ? String(req.body.to).slice(0, 10) : undefined;
      const rebuild = await this.patrimonyRebuild.rebuild(ctx, { from, to });

      return res.json({
        success: true,
        message:
          'Recálculo concluído. Confira o gráfico em Resultado histórico e a carteira em Ações/FIIs.',
        custody,
        positions: posResult,
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
      const resetFirst = req.body?.resetFirst === true;
      const dataMode = req.body?.dataMode as 'recover' | 'reset_from_opening' | undefined;

      console.log(
        `[OptionC] start org=${orgId} resetFirst=${resetFirst} notas=${notesFiles.length} extratos=${extractFiles.length}`
      );

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
        resetFirst,
        dataMode,
      });
      console.log(
        `[OptionC] org=${orgId} iniciado runId=${state.runId} pregões=${state.calendar.length}`
      );
      return res.json({
        success: true,
        message:
          'Opção C iniciada. Use option-c/next-day para fechar cada pregão (cotações web + patrimônio gravado).',
        anchorsSeeded,
        state,
      });
    } catch (error: unknown) {
      const detail = logReconcileFailure('option-c.start', orgId ?? undefined, error, {
        resetFirst: req.body?.resetFirst === true,
        notesFiles: Array.isArray(req.body?.notesFiles) ? req.body.notesFiles.length : 0,
        extractFiles: Array.isArray(req.body?.extractFiles) ? req.body.extractFiles.length : 0,
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
      const result = await this.optionC.closeNextDay(ctx, runId);
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

  /** GET /api/invest/reconcile/option-c/status/:runId */
  optionCStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const state = this.optionC.getRun(String(req.params.runId));
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
