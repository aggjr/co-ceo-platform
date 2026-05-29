import { Request, Response } from 'express';
import { PatrimonyDailyRebuildService } from '../core/invest/PatrimonyDailyRebuildService';
import { LedgerImportService } from '../core/invest/LedgerImportService';
import { rebuildCustodyFromLedger } from '../core/invest/CustodyEngine';
import { computeThreePricesByUnderlying } from '../core/invest/threePricesEngine';
import { MarketQuoteRepository } from '../core/market/MarketQuoteRepository';
import { InvestAssetProjection } from '../modules/invest/sync/InvestAssetProjection';
import { authBootstrapContext } from '../core/auth/authBootstrapContext';
import type { CoCeoDataGateway } from '../core/dal';
import type { SecurePayload } from '../core/dal/types';

export class RemoteRecalcController {
  private readonly patrimonyRebuild: PatrimonyDailyRebuildService;
  private readonly ledger: LedgerImportService;

  constructor(private gateway: CoCeoDataGateway) {
    this.patrimonyRebuild = new PatrimonyDailyRebuildService(gateway);
    this.ledger = new LedgerImportService(gateway);
  }

  /** @deprecated Prefer POST /api/invest/patrimony-daily/rebuild ou /reconcile/recalc-all */
  public recalcCurve = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ctx = req.userContext!;
      if (!ctx.organizationId) {
        return res.status(400).json({ success: false, error: 'Falta organizationId.' });
      }

      const from = req.body?.from ? String(req.body.from).slice(0, 10) : undefined;
      const to = req.body?.to ? String(req.body.to).slice(0, 10) : undefined;
      const result = await this.patrimonyRebuild.rebuild(ctx, { from, to });

      return res.json({
        success: true,
        processed: result.daysWritten,
        skipped: result.daysSkipped,
        ...result,
      });
    } catch (error: unknown) {
      console.error('[RemoteRecalc] recalcCurve:', error);
      const message = error instanceof Error ? error.message : 'Erro interno';
      return res.status(500).json({ success: false, error: message });
    }
  };

  public recalcPositions = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ctx = req.userContext!;
      if (!ctx.organizationId) {
        return res.status(400).json({ success: false, error: 'Falta organizationId.' });
      }

      await this.ledger.reconcileCustody(ctx);

      const from = '2000-01-01';
      const to = new Date().toISOString().slice(0, 10);
      const events = await this.ledger.listLedgerEvents(ctx, from, to);
      const { assets } = rebuildCustodyFromLedger(events);
      const pricesMap = computeThreePricesByUnderlying(events);

      const marketQuoteRepo = new MarketQuoteRepository(this.gateway);
      const stockTickers = assets
        .filter((a) => (a.assetType === 'stock' || a.assetType === 'fii') && a.ticker)
        .map((a) => String(a.ticker).trim().toUpperCase());
      const marketCtx = authBootstrapContext();
      const marketQuoteMap = stockTickers.length
        ? await marketQuoteRepo.loadLatestQuoteMap(marketCtx, stockTickers)
        : new Map<string, { price: number; date: string }>();

      const assetProjection = new InvestAssetProjection(this.gateway);
      const activeRows = await assetProjection.listActiveAssets(ctx);

      let updatedCount = 0;
      for (const asset of assets) {
        if (!asset.assetId || asset.assetType === 'cash') continue;

        const ticker = String(asset.ticker ?? '').trim().toUpperCase();
        let pmA: number | null = null;
        let pmB: number | null = null;
        let pmC: number | null = null;

        if (asset.assetType === 'stock' || asset.assetType === 'fii') {
          const tp = pricesMap.get(ticker);
          if (tp && tp.estrito > 0) {
            pmA = tp.estrito;
            pmB = tp.b3 > 0 ? tp.b3 : tp.estrito;
            pmC = tp.gerencial > 0 ? tp.gerencial : tp.estrito;
          } else if (asset.avgPrice > 0) {
            pmA = asset.avgPrice;
            pmB = asset.avgPrice;
            pmC = asset.avgPrice;
          } else {
            const mq = marketQuoteMap.get(ticker);
            if (mq?.price) {
              pmA = mq.price;
              pmB = mq.price;
              pmC = mq.price;
            }
          }
        } else if (asset.avgPrice > 0) {
          pmA = asset.avgPrice;
          pmB = asset.avgPrice;
          pmC = asset.avgPrice;
        }

        const extRows = await this.gateway.findWhere(ctx, 'invest_position_ext', {
          patrimony_item_id: asset.assetId,
        });

        const lastPrice =
          marketQuoteMap.get(ticker)?.price ??
          (pmC && pmC > 0 ? pmC : null);

        const payload: SecurePayload = {
          pm_estrito: pmA,
          pm_b3: pmB,
          pm_gerencial: pmC,
        };
        if (lastPrice != null && (asset.assetType === 'stock' || asset.assetType === 'fii')) {
          payload.last_price = lastPrice;
        }

        if (extRows.length > 0) {
          await this.gateway.update(ctx, 'invest_position_ext', asset.assetId, payload);
        } else {
          const insertPayload: SecurePayload = {
            patrimony_item_id: asset.assetId,
            organization_id: ctx.organizationId,
            asset_class: asset.assetType,
            ...payload,
          };
          await this.gateway.insert(ctx, 'invest_position_ext', insertPayload);
        }
        updatedCount++;
      }

      void activeRows;

      return res.json({ success: true, updated: updatedCount, processed: updatedCount });
    } catch (error: unknown) {
      console.error('[RemoteRecalc] recalcPositions:', error);
      const message = error instanceof Error ? error.message : 'Erro interno';
      return res.status(500).json({ success: false, error: message });
    }
  };
}
