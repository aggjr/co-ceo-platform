import { Request, Response } from 'express';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { rebuildCustodyFromLedger } from '../core/invest/CustodyEngine';
import { computeThreePricesByUnderlying } from '../core/invest/threePricesEngine';
import { MarketQuoteRepository } from '../core/market/MarketQuoteRepository';
import { InvestAssetProjection } from '../modules/invest/sync/InvestAssetProjection';
import { authBootstrapContext } from '../core/auth/authBootstrapContext';

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

      // Carrega cotações de mercado para todos os tickers da carteira
      // (fallback para ações importadas via opening_balance sem custo)
      const marketQuoteRepo = new MarketQuoteRepository(this.gateway);
      const stockTickers = assets
        .filter((a) => (a.assetType === 'stock' || a.assetType === 'fii') && a.ticker)
        .map((a) => String(a.ticker).trim().toUpperCase());
      const marketCtx = authBootstrapContext();
      const marketQuoteMap = stockTickers.length
        ? await marketQuoteRepo.loadLatestQuoteMap(marketCtx, stockTickers)
        : new Map<string, { price: number; date: string }>();

      // Lê invest_position_ext atual (para preservar last_price e outros campos)
      const assetProjection = new InvestAssetProjection(this.gateway);
      const activeRows = await assetProjection.listActiveAssets(ctx);
      const currentExtByTicker = new Map<string, Record<string, unknown>>();
      for (const row of activeRows) {
        const t = String(row.asset_ticker ?? '').trim().toUpperCase();
        if (t) currentExtByTicker.set(t, row as unknown as Record<string, unknown>);
      }

      let updatedCount = 0;
      for (const asset of assets) {
        if (!asset.assetId) continue;
        if (asset.assetType === 'cash') continue;

        const ticker = String(asset.ticker ?? '').trim().toUpperCase();

        // Verifica se existe registro em invest_position_ext
        const extRows = await this.gateway.findWhere(
          ctx,
          'invest_position_ext',
          { patrimony_item_id: asset.assetId },
          { limit: 1 }
        );

        // Ordem de prioridade para PM:
        // 1. Engine de três preços (estrito/B3/gerencial) — mais preciso
        // 2. avgPrice da custody engine (custo médio ponderado do livro)
        // 3. Cotação atual de mercado — fallback para opening_balance sem custo
        // 4. null — sem dados disponíveis
        let pmA: number | null = null;
        let pmB: number | null = null;
        let pmC: number | null = null;

        if (asset.assetType === 'stock' || asset.assetType === 'fii') {
          const tp = pricesMap.get(ticker);
          if (tp && tp.estrito > 0) {
            // Fonte 1: engine de três preços com custo real
            pmA = tp.estrito;
            pmB = tp.b3 > 0 ? tp.b3 : tp.estrito;
            pmC = tp.gerencial > 0 ? tp.gerencial : tp.estrito;
          } else if (asset.avgPrice > 0) {
            // Fonte 2: custo médio ponderado da custody engine
            pmA = asset.avgPrice;
            pmB = asset.avgPrice;
            pmC = asset.avgPrice;
          }
        } else {
          // Opções e outros: usa avgPrice da custody
          if (asset.avgPrice > 0) {
            pmA = asset.avgPrice;
            pmB = asset.avgPrice;
            pmC = asset.avgPrice;
          }
        }

        console.log(`[RecalcPositions] ${ticker}: pm_estrito=${pmA} pm_b3=${pmB} pm_gerencial=${pmC}`);

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
