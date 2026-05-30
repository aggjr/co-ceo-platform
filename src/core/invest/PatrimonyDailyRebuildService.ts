import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { resolveInvestPeriodBounds } from './investPeriodBounds';
import { LedgerImportService } from './LedgerImportService';
import { PatrimonyDailyRecorder } from './PatrimonyDailyRecorder';
import { PatrimonyDailyStore } from './PatrimonyDailyStore';
import { logReconcileFailure } from './reconcile/reconcileErrorDetail';
import { DailyCloseMaterializeService } from './reconcile/DailyCloseMaterializeService';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';

export type PatrimonyRebuildResult = {
  from: string;
  to: string;
  daysWritten: number;
  daysSkipped: number;
  quotesCoverage: { tickers: number; daysWithQuotes: number };
  warnings: string[];
  threePricesUpdated?: number;
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

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.store = new PatrimonyDailyStore(gateway);
    this.recorder = new PatrimonyDailyRecorder(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
    this.dailyClose = new DailyCloseMaterializeService(gateway);
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
    opts?: { from?: string; to?: string }
  ): Promise<PatrimonyRebuildResult> {
    if (!ctx.organizationId) {
      throw new Error('organizationId obrigatório para rebuild de patrimônio diário.');
    }

    const orgId = ctx.organizationId;
    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const bounds = resolveInvestPeriodBounds(events);

    const from = clampDate(
      (opts?.from ?? bounds.periodMin).slice(0, 10),
      bounds.periodMin,
      today
    );
    const to = clampDate((opts?.to ?? today).slice(0, 10), from, today);

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

      const tickers = await this.listEquityTickers(ctx);
      const quoteMap = await this.marketQuotes.loadQuoteMapForRange(ctx, from, to);
      let daysWithQuotes = 0;
      for (const byDate of quoteMap.values()) {
        if (byDate.size > 0) daysWithQuotes += 1;
      }
      if (tickers.length > 0 && daysWithQuotes === 0) {
        warnings.push(
          'Sem cotações em market_quotes_daily no intervalo — patrimônio usará PM do livro onde faltar preço.'
        );
      }

      for (const day of enumerateCalendarDays(from, to)) {
        if (isWeekend(day)) {
          daysSkipped += 1;
          continue;
        }
        try {
          await this.recorder.recordDay(ctx, day);
          daysWritten += 1;
        } catch (err) {
          daysSkipped += 1;
          const msg = err instanceof Error ? err.message : String(err);
          logReconcileFailure('patrimony-rebuild.record-day', orgId, err, { day });
          if (!msg.includes('Sem patrimônio econômico')) {
            warnings.push(`${day}: ${msg}`);
          }
        }
      }

      await this.ledger.reconcileCustody(ctx);
      const threePrices = await this.dailyClose.recalcThreePricesPublic(ctx, today);

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

  private async listEquityTickers(ctx: UserContext): Promise<string[]> {
    const assets = await this.assetProjection.listActiveAssets(ctx);
    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type ?? '');
      if (
        type === 'fixed_income' ||
        ticker.startsWith('TESOURO-') ||
        ticker.startsWith('CDB-') ||
        ticker.startsWith('LFT-') ||
        ticker.startsWith('TD-')
      ) {
        continue;
      }
      tickers.push(ticker);
    }
    return tickers;
  }
}
