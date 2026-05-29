import { Request, Response } from 'express';
import { CoCeoDataGateway } from '../core/dal';
import { ReconcileResetService } from '../core/invest/ReconcileResetService';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { RemoteRecalcController } from './RemoteRecalcController';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';

export class ReconcileController {
  private readonly resetService: ReconcileResetService;
  private readonly recalcController: RemoteRecalcController;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.resetService = new ReconcileResetService(gateway);
    this.recalcController = new RemoteRecalcController(gateway);
  }

  /**
   * POST /api/invest/reconcile/reset-holding
   *
   * Apaga todos os dados operacionais da holding (exceto opening_balance e dados de sistema)
   * e zera o odômetro de storage. Pronto para reimportar os arquivos.
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

      console.log(`[ReconcileReset] Iniciando reset para org=${orgId} por user=${ctx.userId}`);

      const report = await this.resetService.resetHolding(ctx);

      console.log(`[ReconcileReset] Reset concluído para org=${orgId}. Resumo:`, report.deletedCounts);

      return res.json({
        success: true,
        message: 'Reset concluído. Os dados de inicialização foram preservados. Reimporte os arquivos para repovoar o livro.',
        report,
      });
    } catch (error: any) {
      console.error('[ReconcileReset] Erro no reset:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro interno no reset da holding.',
      });
    }
  };

  /**
   * POST /api/invest/reconcile/recalc-all
   *
   * Dispara o recálculo completo após reimportação:
   * 1. Recalcula posições e 3 preços (recalcPositions)
   * 2. Recalcula curva de patrimônio diário (recalcCurve)
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

      console.log(`[ReconcileRecalc] Iniciando recálculo completo para org=${orgId}`);

      // Fase 1 — posições e 3 preços
      const posResult = await new Promise<any>((resolve) => {
        this.recalcController.recalcPositions(
          req,
          { json: resolve } as any
        );
      });

      // Fase 2 — curva de patrimônio diário
      const curveResult = await new Promise<any>((resolve) => {
        this.recalcController.recalcCurve(
          req,
          { json: resolve } as any
        );
      });

      return res.json({
        success: true,
        message: 'Recálculo completo finalizado.',
        positions: posResult,
        curve: curveResult,
      });
    } catch (error: any) {
      console.error('[ReconcileRecalc] Erro no recálculo:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro interno no recálculo.',
      });
    }
  };
}
