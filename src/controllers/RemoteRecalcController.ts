import { Request, Response } from 'express';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { rebuildCustodyFromLedger } from '../core/invest/CustodyEngine';
import { computeThreePricesByUnderlying } from '../core/invest/threePricesEngine';

export class RemoteRecalcController {
  constructor(private gateway: any) {}

  public recalcCurve = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log('[RemoteRecalc] Iniciando recalculo da curva no servidor...');
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: 'Falta orgId' });
      }

      const recorder = new PatrimonyDailyRecorder(this.gateway);

      const start = new Date('2026-01-01');
      const end = new Date();

      const results = [];
      let current = new Date(start);

      while (current <= end) {
        const dateStr = current.toISOString().slice(0, 10);
        console.log(`[RemoteRecalc] Recalculando para ${dateStr}...`);
        try {
          const result = await recorder.recordDay(ctx, dateStr);
          results.push({ date: dateStr, patrimony: result.economicPatrimony });
        } catch (err: any) {
          console.warn(`[RemoteRecalc] Erro em ${dateStr}: ${err.message}`);
        }
        current.setDate(current.getDate() + 1);
      }

      console.log('[RemoteRecalc] Concluído!');
      return res.json({ success: true, processed: results.length, results });

    } catch (error: any) {
      console.error('[RemoteRecalc] Erro:', error);
      return res.status(500).json({ error: error.message });
    }
  };

  public recalcPositions = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log('[RemoteRecalc] Iniciando recalculo de posicoes (PM) no servidor...');
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: 'Falta orgId' });
      }

      const ledgerService = new LedgerImportService(this.gateway);
      const from = '2000-01-01';
      const to = new Date().toISOString().slice(0, 10);
      const events = await ledgerService.listLedgerEvents(ctx, from, to);
      const { assets } = rebuildCustodyFromLedger(events);
      const pricesMap = computeThreePricesByUnderlying(events);

      let updatedCount = 0;
      for (const asset of assets) {
        if (!asset.assetId) continue;
        if (asset.assetType === 'cash') continue;

        // Verifica se existe registro em invest_position_ext (usa ctx do tenant)
        const extRows = await this.gateway.findWhere(
          ctx,
          'invest_position_ext',
          { patrimony_item_id: asset.assetId },
          { limit: 1 }
        );

        // PM inicial: avgPrice da custody engine (fallback para opening_balance sem custo)
        let pmA: number | null = asset.avgPrice > 0 ? asset.avgPrice : null;
        let pmB: number | null = pmA;
        let pmC: number | null = pmA;

        // Para ações/FIIs: tenta usar os três preços da engine (estrito/B3/gerencial)
        if (asset.assetType === 'stock' || asset.assetType === 'fii') {
          const ticker = String(asset.ticker ?? '').trim().toUpperCase();
          const tp = pricesMap.get(ticker);
          if (tp && tp.estrito > 0) {
            pmA = tp.estrito;
            pmB = tp.b3 > 0 ? tp.b3 : tp.estrito;
            pmC = tp.gerencial > 0 ? tp.gerencial : tp.estrito;
          }
          // Se engine retornou 0 mas avgPrice > 0, mantém avgPrice (já inicializado acima)
        }

        console.log(`[RecalcPositions] ${asset.ticker}: pmA=${pmA} pmB=${pmB} pmC=${pmC} avgPrice=${asset.avgPrice}`);

        if (extRows.length > 0) {
          await this.gateway.update(
            ctx,
            'invest_position_ext',
            asset.assetId,
            { pm_estrito: pmA, pm_b3: pmB, pm_gerencial: pmC }
          );
          updatedCount++;
        } else {
          await this.gateway.insert(
            ctx,
            'invest_position_ext',
            {
              patrimony_item_id: asset.assetId,
              organization_id: orgId,
              asset_class: asset.assetType,
              pm_estrito: pmA,
              pm_b3: pmB,
              pm_gerencial: pmC,
            }
          );
          updatedCount++;
        }
      }

      console.log(`[RemoteRecalc] Concluído! ${updatedCount} posicoes atualizadas.`);
      return res.json({ success: true, updated: updatedCount });

    } catch (error: any) {
      console.error('[RemoteRecalc] Erro:', error);
      return res.status(500).json({ error: error.message });
    }
  };
}
