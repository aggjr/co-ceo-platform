import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { resolveInvestPeriodBounds } from './investPeriodBounds';
import { InvestBookPeriodService } from './InvestBookPeriodService';
import { LedgerImportService } from './LedgerImportService';
import { PatrimonyDailyRecorder } from './PatrimonyDailyRecorder';
import { PatrimonyDailyStore } from './PatrimonyDailyStore';
import { logReconcileFailure } from './reconcile/reconcileErrorDetail';
import { DailyCloseMaterializeService } from './reconcile/DailyCloseMaterializeService';
import { MarketCalendarService } from './MarketCalendarService';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';
import pool from '../../config/database';
import { ensureInvestPositionDailySchema } from '../db/ensureCoreSchema';
import {
  AssetValuationContext,
  requiresMarketQuoteForAsset,
} from './valuation/AssetValuationContext';

export type PatrimonyRebuildResult = {
  from: string;
  to: string;
  daysWritten: number;
  daysSkipped: number;
  quotesCoverage: { tickers: number; daysWithQuotes: number };
  warnings: string[];
  threePricesUpdated?: number;
};

export type PatrimonyRebuildOptions = {
  from?: string;
  to?: string;
  lastTrustedDate?: string;
  /**
   * Reconstrução de carga inicial: habilita estimativa por âncoras mensais para
   * dias passados sem cotação real. Padrão `false` (econômico) — recálculos
   * recorrentes nunca estimam. Ver PatrimonyDailyRecorder.recordDay.
   */
  initialLoad?: boolean;
  onProgress?: (daysWritten: number, daysSkipped: number, currentDay: string) => void;
};

export type PatrimonyRebuildStatus = {
  lastRebuildAt: string | null;
  from: string | null;
  to: string | null;
  inProgress: boolean;
};

const statusByOrg = new Map<string, PatrimonyRebuildStatus>();

function enumerateCalendarDays(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function clampDate(value: string, min: string, max: string): string {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export class PatrimonyDailyRebuildService {
  private readonly ledger: LedgerImportService;
  private readonly store: PatrimonyDailyStore;
  private readonly recorder: PatrimonyDailyRecorder;
  private readonly marketQuotes: MarketQuoteRepository;
  private readonly assetProjection: InvestAssetProjection;
  private readonly dailyClose: DailyCloseMaterializeService;
  private readonly valuation: AssetValuationContext;
  private readonly periods: InvestBookPeriodService;
  private readonly marketCalendar: MarketCalendarService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.store = new PatrimonyDailyStore(gateway);
    this.recorder = new PatrimonyDailyRecorder(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
    this.dailyClose = new DailyCloseMaterializeService(gateway);
    this.valuation = new AssetValuationContext(gateway);
    this.periods = new InvestBookPeriodService(gateway);
    this.marketCalendar = new MarketCalendarService(gateway);
  }

  getStatus(ctx: UserContext): PatrimonyRebuildStatus {
    const orgId = ctx.organizationId ?? '';
    return (
      statusByOrg.get(orgId) ?? {
        lastRebuildAt: null,
        from: null,
        to: null,
        inProgress: false,
      }
    );
  }

  async rebuild(
    ctx: UserContext,
    opts: PatrimonyRebuildOptions = {}
  ): Promise<PatrimonyRebuildResult> {
    if (!ctx.organizationId) {
      throw new Error('organizationId obrigatório para rebuild de patrimônio diário.');
    }

    const orgId = ctx.organizationId;
    await ensureInvestPositionDailySchema(pool);
    const today = new Date().toISOString().slice(0, 10);
    const period = await this.resolvePeriodOrNull(ctx);
    const events = await this.ledger.listLedgerEvents(
      ctx,
      period?.openingDate ?? '2000-01-01',
      today
    );
    const bounds = resolveInvestPeriodBounds(events, {
      openingDate: period?.openingDate ?? null,
    });
    const lastTrusted = (
      opts.lastTrustedDate ??
      (await this.marketQuotes.getLastQuoteDate(ctx)) ??
      today
    ).slice(0, 10);
    const maxTo = lastTrusted < today ? lastTrusted : today;
    const effectiveMaxTo = maxTo < bounds.periodMin ? bounds.periodMin : maxTo;

    const from = clampDate(
      (opts?.from ?? bounds.periodMin).slice(0, 10),
      bounds.periodMin,
      effectiveMaxTo
    );
    const to = clampDate((opts?.to ?? effectiveMaxTo).slice(0, 10), from, effectiveMaxTo);

    statusByOrg.set(orgId, {
      lastRebuildAt: null,
      from,
      to,
      inProgress: true,
    });

    const warnings: string[] = [];
    let daysWritten = 0;
    let daysSkipped = 0;

    try {
      await this.store.invalidateFromDate(ctx, from);

      const tickers = await this.listQuotedAssetTickers(ctx);
      const quoteMap = await this.marketQuotes.loadQuoteMapForRange(ctx, from, to);
      let daysWithQuotes = 0;
      for (const byDate of quoteMap.values()) {
        if (byDate.size > 0) daysWithQuotes += 1;
      }
      if (tickers.length > 0 && daysWithQuotes === 0) {
        warnings.push(
          'Sem cotacoes em market_quotes_daily no intervalo; dias uteis com ativos cotaveis abertos serao bloqueados.'
        );
      }
      if ((opts.to ?? today).slice(0, 10) > effectiveMaxTo) {
        warnings.push(
          `Rebuild limitado ate ${effectiveMaxTo} por lastTrustedDate/ultima cotacao disponivel.`
        );
      }

      for (const day of enumerateCalendarDays(from, to)) {
        if (isWeekend(day) || (await this.marketCalendar.isHoliday(ctx, day))) {
          daysSkipped += 1;
          continue;
        }
        try {
          await this.recorder.recordDay(ctx, day, {
            initialLoad: opts.initialLoad === true,
          });
          daysWritten += 1;
        } catch (err) {
          daysSkipped += 1;
          const msg = err instanceof Error ? err.message : String(err);
          logReconcileFailure('patrimony-rebuild.record-day', orgId, err, { day });
          if (!msg.includes('Sem patrimônio econômico')) {
            warnings.push(`${day}: ${msg}`);
          }
        }
        // Emite progresso a cada 10 dias para logs em tempo real
        if ((daysWritten + daysSkipped) % 10 === 0 && opts.onProgress) {
          opts.onProgress(daysWritten, daysSkipped, day);
        }
      }

      await this.ledger.reconcileCustody(ctx);
      const threePrices = await this.dailyClose.recalcThreePricesPublic(ctx, to);

      const finishedAt = new Date().toISOString();
      statusByOrg.set(orgId, {
        lastRebuildAt: finishedAt,
        from,
        to,
        inProgress: false,
      });

      return {
        from,
        to,
        daysWritten,
        daysSkipped,
        quotesCoverage: { tickers: tickers.length, daysWithQuotes },
        warnings,
        threePricesUpdated: threePrices.positionsUpdated,
      };
    } catch (err) {
      statusByOrg.set(orgId, {
        lastRebuildAt: statusByOrg.get(orgId)?.lastRebuildAt ?? null,
        from,
        to,
        inProgress: false,
      });
      throw err;
    }
  }

  private async listQuotedAssetTickers(ctx: UserContext): Promise<string[]> {
    const assets = await this.assetProjection.listActiveAssets(ctx);
    const valuationSnapshot = await this.valuation.load(ctx);
    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type ?? '');
      if (!requiresMarketQuoteForAsset(valuationSnapshot, type, ticker)) continue;
      tickers.push(ticker);
    }
    return tickers;
  }

  private async resolvePeriodOrNull(ctx: UserContext) {
    try {
      return await this.periods.resolveDefault(ctx);
    } catch (err) {
      if (err instanceof GatewayError && err.code === 'INVEST_BOOK_PERIOD_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }
}
