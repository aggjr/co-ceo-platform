/**
 * Popula histórico de cotações em market_quotes_daily para todos os tickers em uso
 * (ou um conjunto específico). Usa brapi com range histórico.
 *
 * brapi aceita range em [1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max].
 *
 * Uso:
 *   npm run backfill:market:quotes -- --range=5y
 *   npm run backfill:market:quotes -- --range=ytd
 *   npm run backfill:market:quotes -- --range=2y --tickers=PETR4,VALE3
 *   npm run backfill:market:quotes -- --from=2024-01-01 --to=2026-05-22 --tickers=ITUB4
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';

dotenv.config();

type Args = {
  range: string;
  from?: string;
  to?: string;
  tickers?: string[];
};

function parseArgs(): Args {
  let range = '5y';
  let from: string | undefined;
  let to: string | undefined;
  let tickers: string[] | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--range=')) range = arg.slice(8);
    else if (arg.startsWith('--from=')) from = arg.slice(7).slice(0, 10);
    else if (arg.startsWith('--to=')) to = arg.slice(5).slice(0, 10);
    else if (arg.startsWith('--tickers='))
      tickers = arg.slice(10).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  }
  if (from && !to) to = new Date().toISOString().slice(0, 10);
  return { range, from, to, tickers };
}

type BrapiBar = { date: number; close: number; open?: number; low?: number; high?: number; volume?: number };
type BrapiRow = { symbol: string; historicalDataPrice?: BrapiBar[] };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Fallback sem BRAPI_TOKEN — Yahoo Finance (.SA). */
async function fetchYahooHistory(
  ticker: string,
  from: string,
  to: string
): Promise<BrapiBar[]> {
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
  if (!res.ok) {
    throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
  };
  const result = json.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const bars: BrapiBar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date: stamps[i]!, close });
  }
  return bars;
}

async function fetchHistoryBatch(
  tickers: string[],
  range: string
): Promise<Map<string, BrapiBar[]>> {
  const base = 'https://brapi.dev/api';
  const token = process.env.BRAPI_TOKEN || '';
  const out = new Map<string, BrapiBar[]>();

  for (const batch of chunk(tickers, 18)) {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('range', range);
    params.set('interval', '1d');
    const url = `${base}/quote/${encodeURIComponent(batch.join(','))}?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`brapi HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json()) as { results?: BrapiRow[] };
    for (const row of json.results || []) {
      const ticker = String(row.symbol || '').toUpperCase();
      if (!ticker) continue;
      out.set(ticker, row.historicalDataPrice || []);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const repo = new MarketQuoteRepository(gateway);

  let tickers: string[];
  if (args.tickers?.length) {
    tickers = args.tickers;
    console.log(`Tickers do argumento: ${tickers.length}`);
  } else {
    tickers = await repo.listTickersInUse(ctx);
    console.log(`Tickers em uso (todos os clientes): ${tickers.length}`);
  }
  if (!tickers.length) {
    console.log('Nada para fazer.');
    await pool.end();
    return;
  }

  const fromIso = args.from || '2020-01-01';
  const toIso = args.to || new Date().toISOString().slice(0, 10);
  const series = new Map<string, BrapiBar[]>();

  const token = process.env.BRAPI_TOKEN || '';
  if (token) {
    console.log(`brapi range=${args.range}  ${fromIso} → ${toIso}`);
    const brapi = await fetchHistoryBatch(tickers, args.range);
    for (const [t, bars] of brapi.entries()) series.set(t, bars);
  } else {
    console.log('BRAPI_TOKEN ausente — histórico via Yahoo Finance (.SA)');
  }

  for (const ticker of tickers) {
    if (series.has(ticker) && (series.get(ticker)?.length ?? 0) > 0) continue;
    try {
      const bars = await fetchYahooHistory(ticker, fromIso, toIso);
      series.set(ticker, bars);
      console.log(`  Yahoo ${ticker}: ${bars.length} barra(s)`);
    } catch (e) {
      console.warn(`  Yahoo ${ticker} falhou:`, e instanceof Error ? e.message : e);
    }
  }

  let totalBars = 0;
  let totalSaved = 0;
  let totalSkipped = 0;
  for (const [ticker, bars] of series.entries()) {
    let savedTicker = 0;
    for (const bar of bars) {
      const date = new Date(bar.date * 1000).toISOString().slice(0, 10);
      if (args.from && date < args.from) {
        totalSkipped += 1;
        continue;
      }
      if (args.to && date > args.to) {
        totalSkipped += 1;
        continue;
      }
      if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
      await repo.upsertQuote(ctx, {
        ticker,
        quoteDate: date,
        closingPrice: bar.close,
        source: token ? 'brapi' : 'user_manual',
        metadata: { kind: 'close', backfill: true, provider: token ? 'brapi' : 'yahoo_finance' },
      });
      savedTicker += 1;
      totalBars += 1;
    }
    totalSaved += savedTicker;
    console.log(`  ${ticker}: ${savedTicker} dia(s) salvos`);
  }
  const missing = tickers.filter((t) => !series.has(t));
  if (missing.length) console.log(`Sem histórico: ${missing.join(', ')}`);

  console.log(`\nTotal: ${totalSaved} cotações gravadas (puladas fora do range: ${totalSkipped}; barras totais: ${totalBars}).`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
