import { Request, Response } from 'express';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { rebuildCustodyFromLedger } from '../core/invest/CustodyEngine';
import { computeThreePricesByUnderlying } from '../core/invest/threePricesEngine';
import { CoCeoDataGateway } from '../core/dal/CoCeoDataGateway';
import { SYSTEM_INSTALLER_USER_ID } from '../core/dal/types';

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
        
        // Verifica se existe invest_position_ext
        const extRows = await this.gateway.findWhere(
          { userId: SYSTEM_INSTALLER_USER_ID, organizationId: orgId, impersonatorId: null, scope: 'global' },
          'invest_position_ext',
          { patrimony_item_id: asset.assetId },
          { limit: 1 }
        );

        let pmA = asset.avgPrice;
        let pmB = asset.avgPrice;
        let pmC = asset.avgPrice;

        if (asset.assetType === 'stock' || asset.assetType === 'fii') {
          const tp = pricesMap.get(asset.ticker);
          if (tp) {
            pmA = tp.estrito;
            pmB = tp.b3;
            pmC = tp.gerencial;
          }
        }

        if (extRows.length > 0) {
          await this.gateway.update(
            { userId: SYSTEM_INSTALLER_USER_ID, organizationId: orgId, impersonatorId: null, scope: 'global' },
            'invest_position_ext',
            extRows[0].id,
            { pm_estrito: pmA, pm_b3: pmB, pm_gerencial: pmC }
          );
          updatedCount++;
        } else {
          await this.gateway.insert(
            { userId: SYSTEM_INSTALLER_USER_ID, organizationId: orgId, impersonatorId: null, scope: 'global' },
            'invest_position_ext',
            { 
              patrimony_item_id: asset.assetId,
              asset_class: asset.assetType,
              pm_estrito: pmA,
              pm_b3: pmB,
              pm_gerencial: pmC
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

