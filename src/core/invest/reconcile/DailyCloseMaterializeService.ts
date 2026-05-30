import type { CoCeoDataGateway, UserContext } from '../../dal';
import { authBootstrapContext } from '../../auth/authBootstrapContext';
import { InvestQuoteSyncService } from '../InvestQuoteSyncService';
import { OptionMarketSyncService } from '../OptionMarketSyncService';
import { PatrimonyDailyRecorder } from '../PatrimonyDailyRecorder';
import { PatrimonyDailyStore } from '../PatrimonyDailyStore';
import { LedgerImportService } from '../LedgerImportService';
import { rebuildCustodyFromLedger } from '../CustodyEngine';
import { computeThreePricesByUnderlying } from '../threePricesEngine';
import { MarketQuoteRepository } from '../../market/MarketQuoteRepository';
import { InvestAssetProjection } from '../../../modules/invest/sync/InvestAssetProjection';
import type { SecurePayload } from '../../dal/types';
import { inferAssetType } from '../assetClassifier';
import { logReconcileFailure } from './reconcileErrorDetail';

export type QuoteSyncDayReport = {
  date: string;
  stocksRequested: number;
  stocksSaved: number;
  stocksMissing: string[];
  optionsSynced: number;
  optionErrors: number;
  warnings: string[];
};

export type MaterializeDayReport = {
  date: string;
  quoteSync: QuoteSyncDayReport;
  patrimonyRecorded: boolean;
  economicPatrimony: number | null;
  positionsUpdated: number;
  positionsZeroed: number;
  custody: unknown;
};

function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Fechamento diário canônico: cotações (brapi + opcoes.net) → patrimônio gravado → custódia → 3 preços.
 */
export class DailyCloseMaterializeService {
  private readonly quoteSync: InvestQuoteSyncService;
  private readonly optionMarket: OptionMarketSyncService;
  private readonly recorder: PatrimonyDailyRecorder;
  private readonly store: PatrimonyDailyStore;
  private readonly ledger: LedgerImportService;
  private readonly marketQuotes: MarketQuoteRepository;
  private readonly assetProjection: InvestAssetProjection;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.quoteSync = new InvestQuoteSyncService(gateway);
    this.optionMarket = new OptionMarketSyncService(gateway);
    this.recorder = new PatrimonyDailyRecorder(gateway);
    this.store = new PatrimonyDailyStore(gateway);
    this.ledger = new LedgerImportService(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
  }

  async syncQuotesForDate(ctx: UserContext, date: string): Promise<QuoteSyncDayReport> {
    const day = date.slice(0, 10);
    const warnings: string[] = [];

    if (isWeekend(day)) {
      warnings.push(`${day} é fim de semana — cotações de pregão podem repetir último dia útil.`);
    }

    const stockResult = await this.quoteSync.syncFromBrapi(ctx, day);
    const optionReport = await this.optionMarket.syncFromOpcoesNet(ctx, { asOfDate: day });

    if (stockResult.missing.length) {
      warnings.push(
        `Sem cotação brapi em ${day} para: ${stockResult.missing.slice(0, 8).join(', ')}` +
          (stockResult.missing.length > 8 ? '…' : '') +
          ' — patrimônio usará PM do livro ou estimativa de opção.'
      );
    }
    if (optionReport.errors.length) {
      warnings.push(
        `${optionReport.errors.length} subjacente(s) opcoes.net indisponível(is) — opções estimadas pelo motor MTM.`
      );
    }

    return {
      date: day,
      stocksRequested: stockResult.requested,
      stocksSaved: stockResult.updated,
      stocksMissing: stockResult.missing,
      optionsSynced: optionReport.inserted + optionReport.updated,
      optionErrors: optionReport.errors.length,
      warnings,
    };
  }

  async materializeDay(ctx: UserContext, date: string): Promise<MaterializeDayReport> {
    const day = date.slice(0, 10);
    const quoteSync = await this.syncQuotesForDate(ctx, day);

    await this.store.invalidateFromDate(ctx, day);

    let patrimonyRecorded = false;
    let economicPatrimony: number | null = null;
    try {
      const rec = await this.recorder.recordDay(ctx, day);
      patrimonyRecorded = true;
      economicPatrimony = rec.economicPatrimony;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      quoteSync.warnings.push(`Patrimônio ${day}: ${msg}`);
      logReconcileFailure('daily-close.patrimony', ctx.organizationId ?? undefined, err, { date: day });
    }

    const custody = await this.ledger.reconcileCustody(ctx);
    const { positionsUpdated, positionsZeroed } = await this.recalcThreePrices(ctx, day);

    return {
      date: day,
      quoteSync,
      patrimonyRecorded,
      economicPatrimony,
      positionsUpdated,
      positionsZeroed,
      custody,
    };
  }

  async recalcThreePricesPublic(
    ctx: UserContext,
    asOfDate: string
  ): Promise<{ positionsUpdated: number; positionsZeroed: number }> {
    return this.recalcThreePrices(ctx, asOfDate);
  }

  private async recalcThreePrices(
    ctx: UserContext,
    asOfDate: string
  ): Promise<{ positionsUpdated: number; positionsZeroed: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const { assets } = rebuildCustodyFromLedger(events);
    const pricesMap = computeThreePricesByUnderlying(events);

    const marketCtx = authBootstrapContext();
    const stockTickers = assets
      .filter((a) => (a.assetType === 'stock' || a.assetType === 'fii') && a.ticker)
      .map((a) => String(a.ticker).trim().toUpperCase());
    const marketQuoteMap = stockTickers.length
      ? await this.marketQuotes.loadLatestQuoteMap(marketCtx, stockTickers)
      : new Map<string, { price: number; date: string }>();

    const openAssetIds = new Set(assets.map((a) => a.assetId));
    let positionsUpdated = 0;
    let positionsZeroed = 0;

    for (const asset of assets) {
      if (!asset.assetId || asset.assetType === 'cash') continue;

      const ticker = String(asset.ticker ?? '').trim().toUpperCase();
      let pmA: number | null = null;
      let pmB: number | null = null;
      let pmC: number | null = null;

      if (asset.assetType === 'stock' || asset.assetType === 'fii') {
        const tp = pricesMap.get(ticker);
        if (tp && tp.qty > 0 && tp.estrito > 0) {
          pmA = tp.estrito;
          pmB = tp.b3 > 0 ? tp.b3 : tp.estrito;
          pmC = tp.gerencial > 0 ? tp.gerencial : tp.estrito;
        } else if (asset.avgPrice > 0) {
          pmA = asset.avgPrice;
          pmB = asset.avgPrice;
          pmC = asset.avgPrice;
        }
      } else if (asset.avgPrice > 0) {
        pmA = asset.avgPrice;
        pmB = asset.avgPrice;
        pmC = asset.avgPrice;
      }

      const mq = marketQuoteMap.get(ticker);
      const lastPrice =
        mq?.price ?? (pmC && pmC > 0 ? pmC : null);

      await this.upsertPositionExt(ctx, asset.assetId, asset.assetType, {
        pm_estrito: pmA,
        pm_b3: pmB,
        pm_gerencial: pmC,
        last_price:
          lastPrice != null && (asset.assetType === 'stock' || asset.assetType === 'fii')
            ? lastPrice
            : undefined,
      });
      positionsUpdated += 1;
    }

    const allRows = await this.assetProjection.listActiveAssets(ctx);
    for (const row of allRows) {
      const qty = Number(row.current_quantity ?? 0);
      if (Math.abs(qty) >= 1e-9) continue;
      if (openAssetIds.has(String(row.id))) continue;
      const type = String(row.asset_type ?? inferAssetType(String(row.asset_ticker)));
      if (type === 'cash' || String(row.asset_ticker).startsWith('CAIXA-')) continue;

      await this.upsertPositionExt(ctx, String(row.id), type, {
        pm_estrito: null,
        pm_b3: null,
        pm_gerencial: null,
        last_price: null,
      });
      positionsZeroed += 1;
    }

    void asOfDate;
    return { positionsUpdated, positionsZeroed };
  }

  private async upsertPositionExt(
    ctx: UserContext,
    assetId: string,
    assetType: string,
    fields: {
      pm_estrito: number | null;
      pm_b3: number | null;
      pm_gerencial: number | null;
      last_price?: number | null;
    }
  ): Promise<void> {
    const extRows = await this.gateway.findWhere(ctx, 'invest_position_ext', {
      patrimony_item_id: assetId,
    });

    const payload: SecurePayload = {
      pm_estrito: fields.pm_estrito,
      pm_b3: fields.pm_b3,
      pm_gerencial: fields.pm_gerencial,
    };
    if (fields.last_price !== undefined) {
      payload.last_price = fields.last_price;
    }

    if (extRows.length > 0) {
      await this.gateway.update(ctx, 'invest_position_ext', assetId, payload);
      return;
    }

    if (!ctx.organizationId) return;
    const insertPayload: SecurePayload = {
      patrimony_item_id: assetId,
      asset_class: assetType,
      ...payload,
    };
    await this.gateway.insert(ctx, 'invest_position_ext', insertPayload);
  }
}
