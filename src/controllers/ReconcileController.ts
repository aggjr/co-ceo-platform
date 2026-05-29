import { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { CoCeoDataGateway } from '../core/dal';
import { GatewayError } from '../core/dal/errors';
import { HoldingPurgeKeepOpeningService } from '../core/invest/HoldingPurgeKeepOpeningService';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { PatrimonyDailyRebuildService } from '../core/invest/PatrimonyDailyRebuildService';
import { RemoteRecalcController } from './RemoteRecalcController';

export class ReconcileController {
  private readonly holdingPurge: HoldingPurgeKeepOpeningService;
  private readonly ledger: LedgerImportService;
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly recalcController: RemoteRecalcController;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    pool: Pool
  ) {
    this.holdingPurge = new HoldingPurgeKeepOpeningService(gateway, pool);
    this.ledger = new LedgerImportService(gateway);
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.recalcController = new RemoteRecalcController(gateway);
  }

  /**
   * POST /api/invest/reconcile/reset-holding
   *
   * Purge canônico (HoldingPurgeKeepOpeningService): preserva abertura OPENING + pernas
   * opening_balance, zera odômetro, reconcilia custódia.
   */
  resetHolding = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
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
      console.error('[ReconcileReset] Erro no reset:', error);
      const status = error instanceof GatewayError ? error.httpStatus : 500;
      const message = error instanceof Error ? error.message : 'Erro interno no reset da holding.';
      return res.status(status).json({ success: false, error: message });
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
    try {
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
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
      console.error('[ReconcileRecalc] Erro no recálculo:', error);
      const message = error instanceof Error ? error.message : 'Erro interno no recálculo.';
      return res.status(500).json({ success: false, error: message });
    }
  };
}
