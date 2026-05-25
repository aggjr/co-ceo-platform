import type { Pool } from 'mysql2/promise';
import { runSqlFile, tableExists } from '../db/sqlMigrationRunner';
import type { CoCeoDataGateway, UserContext } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import { MarketQuoteRepository } from './MarketQuoteRepository';

type IndexSpec = { code: string; sgs: number; sourceTag: string; rateKind: 'daily_pct' | 'annual_pct' };

const INDICES: IndexSpec[] = [
  { code: 'CDI', sgs: 11, sourceTag: 'bcb_sgs_11', rateKind: 'daily_pct' },
  { code: 'SELIC', sgs: 1178, sourceTag: 'bcb_sgs_1178', rateKind: 'annual_pct' },
];

export type MarketBenchmarkSeedResult = {
  schemaReady: boolean;
  cdiDays: number;
  selicDays: number;
  stockTicker: string;
  stockDays: number;
  from: string;
  to: string;
};

function indexFactors(pct: number, rateKind: IndexSpec['rateKind']) {
  if (rateKind === 'annual_pct') {
    const annual = pct / 100;
    const dailyFactor = Math.pow(1 + annual, 1 / 252);
    return {
      dailyFactor: Math.round(dailyFactor * 1_000_000_000_000) / 1_000_000_000_000,
      annualizedRate: Math.round(annual * 1_000_000) / 1_000_000,
    };
  }
  const dailyFactor = 1 + pct / 100;
  return {
    dailyFactor: Math.round(dailyFactor * 1_000_000_000_000) / 1_000_000_000_000,
    annualizedRate: Math.round((Math.pow(dailyFactor, 252) - 1) * 1_000_000) / 1_000_000,
  };
}

function isoToBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

type BcbRow = { data: string; valor: string };

async function fetchBcbSeries(sgs: number, from: string, to: string): Promise<BcbRow[]> {
  const url =
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${sgs}/dados` +
    `?dataInicial=${encodeURIComponent(isoToBr(from))}` +
    `&dataFinal=${encodeURIComponent(isoToBr(to))}` +
    `&formato=json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new Error(`BCB SGS ${sgs} HTTP ${res.status}`);
  }
  return (await res.json()) as BcbRow[];
}

function brToIso(br: string): string {
  const [d, m, y] = br.split('/');
  return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

async function fetchYahooHistory(ticker: string, from: string, to: string) {
  const symbol = `${ticker.toUpperCase()}.SA`;
  const period1 = Math.floor(new Date(`${from}T12:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }>;
    };
  };
  const result = json.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const bars: { date: string; close: number }[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date: new Date(stamps[i]! * 1000).toISOString().slice(0, 10), close });
  }
  return bars;
}

export class MarketBenchmarkSeeder {
  private readonly repo: MarketQuoteRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.repo = new MarketQuoteRepository(gateway);
  }

  async ensureSchema(pool: Pool): Promise<boolean> {
    if (await tableExists(pool, 'market_quotes_daily')) return true;
    await runSqlFile(pool, '22_market_quotes_global.sql');
    return true;
  }

  async seed(
    ctx: UserContext,
    options: { from: string; to: string; stockTicker?: string }
  ): Promise<MarketBenchmarkSeedResult> {
    const from = options.from.slice(0, 10);
    const to = options.to.slice(0, 10);
    const stockTicker = (options.stockTicker || process.env.INVEST_CHART_BENCHMARK_TICKER || '')
      .trim()
      .toUpperCase();
    if (!stockTicker) {
      throw new Error('stockTicker obrigatório (parâmetro ou INVEST_CHART_BENCHMARK_TICKER).');
    }

    let cdiDays = 0;
    let selicDays = 0;
    for (const idx of INDICES) {
      const rows = await fetchBcbSeries(idx.sgs, from, to);
      for (const r of rows) {
        const date = brToIso(r.data);
        const pct = Number(r.valor);
        if (!Number.isFinite(pct)) continue;
        const { dailyFactor, annualizedRate } = indexFactors(pct, idx.rateKind);
        await this.repo.upsertIndex(ctx, {
          indexCode: idx.code,
          referenceDate: date,
          dailyFactor,
          annualizedRate,
          source: idx.sourceTag,
        });
        if (idx.code === 'CDI') cdiDays += 1;
        if (idx.code === 'SELIC') selicDays += 1;
      }
    }

    const token = process.env.BRAPI_TOKEN || '';
    let stockDays = 0;
    const bars = token
      ? await this.fetchBrapiHistory(stockTicker, from, to, token)
      : await fetchYahooHistory(stockTicker, from, to);

    for (const bar of bars) {
      if (bar.date < from || bar.date > to) continue;
      await this.repo.upsertQuote(ctx, {
        ticker: stockTicker,
        quoteDate: bar.date,
        closingPrice: bar.close,
        source: token ? 'brapi' : 'user_manual',
        metadata: { kind: 'close', backfill: true, provider: token ? 'brapi' : 'yahoo_finance' },
      });
      stockDays += 1;
    }

    return {
      schemaReady: true,
      cdiDays,
      selicDays,
      stockTicker,
      stockDays,
      from,
      to,
    };
  }

  private async fetchBrapiHistory(ticker: string, from: string, to: string, token: string) {
    const params = new URLSearchParams({ token, range: '1y', interval: '1d' });
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return fetchYahooHistory(ticker, from, to);
    const json = (await res.json()) as {
      results?: Array<{ historicalDataPrice?: Array<{ date: number; close: number }> }>;
    };
    const bars: { date: string; close: number }[] = [];
    for (const bar of json.results?.[0]?.historicalDataPrice || []) {
      const date = new Date(bar.date * 1000).toISOString().slice(0, 10);
      if (date < from || date > to) continue;
      if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
      bars.push({ date, close: bar.close });
    }
    return bars.length ? bars : fetchYahooHistory(ticker, from, to);
  }
}

export async function seedMarketBenchmarks(
  gateway: CoCeoDataGateway,
  pool: Pool,
  options?: { from?: string; to?: string; stockTicker?: string }
) {
  const seeder = new MarketBenchmarkSeeder(gateway);
  await seeder.ensureSchema(pool);
  const ctx = authBootstrapContext();
  const from = options?.from || process.env.MARKET_INDEX_SYNC_FROM || '2025-12-01';
  const to = options?.to || new Date().toISOString().slice(0, 10);
  return seeder.seed(ctx, { from, to, stockTicker: options?.stockTicker });
}
