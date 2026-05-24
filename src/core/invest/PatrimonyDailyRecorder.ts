import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { LedgerImportService } from './LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from './PatrimonyMtmDailyEngine';
import { loadPatrimonyAnchors } from './patrimonyAnchors';
import { fixedIncomeTotalFromLedger } from './patrimonyLedgerGates';
import { PatrimonyDailyStore, type StoredPortfolioDay } from './PatrimonyDailyStore';
import { aggregateExternalFlowsByDate } from './portfolioPerformance';
import { InvestAssetProjection } from '../../modules/invest/sync/InvestAssetProjection';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';

export type RecordDailyPatrimonyResult = {
  snapshotDate: string;
  recorded: StoredPortfolioDay;
  positionsSaved: number;
  quotesAsOf: string | null;
};

export class PatrimonyDailyRecorder {
  private readonly ledger: LedgerImportService;
  private readonly store: PatrimonyDailyStore;
  private readonly assetProjection: InvestAssetProjection;
  private readonly marketQuotes: MarketQuoteRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.store = new PatrimonyDailyStore(gateway);
    this.assetProjection = new InvestAssetProjection(gateway);
    this.marketQuotes = new MarketQuoteRepository(gateway);
  }

  async loadStockQuotes(ctx: UserContext, asOf?: string): Promise<{
    quotes: Record<string, number>;
    quotesAsOf: string | null;
  }> {
    if (!ctx.organizationId) return { quotes: {}, quotesAsOf: null };
    const targetDate = (asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const assets = await this.assetProjection.listActiveAssets(ctx);

    // Tickers relevantes (excluindo caixa e renda fixa)
    const tickers: string[] = [];
    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker || ticker.startsWith('CAIXA-')) continue;
      const type = String(row.asset_type ?? '');
      if (type === 'fixed_income' || ticker.startsWith('TESOURO-') ||
          ticker.startsWith('CDB-') || ticker.startsWith('LFT-') || ticker.startsWith('TD-')) continue;
      tickers.push(ticker);
    }

    // Prefere market_quotes_daily; fallback para invest_position_ext
    const quotes: Record<string, number> = {};
    let quotesAsOf: string | null = null;

    const marketMap = await this.marketQuotes.loadLatestQuoteMap(ctx, tickers);

    for (const row of assets) {
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker) continue;

      // Tenta market_quotes_daily primeiro
      const mq = marketMap.get(ticker);
      if (mq && Number.isFinite(mq.price) && mq.price > 0) {
        quotes[ticker] = mq.price;
        if (!quotesAsOf || mq.date > quotesAsOf) quotesAsOf = mq.date;
        continue;
      }

      // Fallback: invest_position_ext via metadata
      let meta: { last_price?: number; quote_as_of?: string } = {};
      if (row.metadata) {
        try {
          meta = typeof row.metadata === 'string'
            ? JSON.parse(row.metadata)
            : (row.metadata as { last_price?: number; quote_as_of?: string });
        } catch { meta = {}; }
      }
      const lp = Number(meta.last_price ?? row.managerial_avg_price ?? 0);
      if (Number.isFinite(lp) && lp >= 0) quotes[ticker] = lp;
      if (meta.quote_as_of) {
        const qd = String(meta.quote_as_of).slice(0, 10);
        if (!quotesAsOf || qd > quotesAsOf) quotesAsOf = qd;
      }
    }

    void targetDate; // reservado para futura query por data específica
    return { quotes, quotesAsOf };
  }

  /**
   * Grava fechamento econômico do dia em invest_portfolio_daily (patrimônio, TWR dia/acum.)
   * e invest_daily_snapshots por ativo. Sem calibração BTG — curva real para histórico futuro.
   * Ajuste de caixa semanal: lançar TEDs no livro antes do fechamento da noite.
   * @param snapshotDate YYYY-MM-DD (padrão: hoje UTC)
   */
  async recordDay(ctx: UserContext, snapshotDate?: string): Promise<RecordDailyPatrimonyResult> {
    const date = (snapshotDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const anchors = loadPatrimonyAnchors();
    const { quotes: stockQuotes, quotesAsOf } = await this.loadStockQuotes(ctx, date);

    // Cotações históricas de market_quotes_daily para o dia — prefere o dado real de mercado
    const quoteMap = await this.marketQuotes.loadQuoteMapForRange(ctx, date, date);
    const quoteForDate = this.marketQuotes.buildQuoteForDateFn(quoteMap);

    const events = await this.ledger.listLedgerEvents(ctx, '2020-01-01', date);
    const ledgerFrom =
      events.length > 0
        ? String(events[0]!.transaction_date).slice(0, 10)
        : date;
    const mtm = buildDailyPatrimonyMtmSeries(events, ledgerFrom, date, {
      anchors,
      stockQuotes,
      fixedIncomeTotal: fixedIncomeTotalFromLedger(events),
      calibrateToAnchors: false,
      quoteForDate,
    });

    const point = mtm.series[mtm.series.length - 1];
    if (!point || point.date !== date) {
      throw new Error(`Sem patrimônio calculado para ${date}.`);
    }

    const patrimonyGross = point.patrimonyGross;

    const flowsByDate = aggregateExternalFlowsByDate(events, date, date);
    const externalFlow = flowsByDate.get(date) ?? 0;

    const prev = await this.store.loadDayBefore(ctx, date);
    let dailyReturnTwr: number | null = null;
    let cumulativeTwr: number | null = null;

    if (prev && prev.patrimony > 0) {
      dailyReturnTwr =
        Math.round(((point.patrimony - prev.patrimony - externalFlow) / prev.patrimony) * 10000) /
        10000;
      const prevCum = prev.cumulative_twr ?? 0;
      cumulativeTwr =
        dailyReturnTwr != null
          ? Math.round(((1 + prevCum) * (1 + dailyReturnTwr) - 1) * 10000) / 10000
          : prevCum;
    } else {
      dailyReturnTwr = 0;
      cumulativeTwr = 0;
    }

    const positions = mtm.positionSnapshots ?? [];
    const recorded = await this.store.upsertPortfolioDay(ctx, {
      snapshotDate: date,
      point,
      patrimonyGross,
      fixedIncomeTotal: fixedIncomeTotalFromLedger(events),
      externalFlow,
      dailyReturnTwr,
      cumulativeTwr,
      quotesAsOf,
      positionSnapshots: positions,
      stockQuotes,
    });

    return {
      snapshotDate: date,
      recorded,
      positionsSaved: positions.length,
      quotesAsOf,
    };
  }
}
