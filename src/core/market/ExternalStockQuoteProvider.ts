export type ExternalStockQuoteResult = {
  ticker: string;
  price: number;
  asOf: string;
  source: ExternalStockQuoteProviderName;
  kind: 'close';
};

export type ExternalStockQuoteProviderName =
  | 'yahoo_finance'
  | 'stooq'
  | 'statusinvest'
  | 'investidor10';

type YahooChartResult = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function toUnixSeconds(iso: string, endOfDay = false): number {
  const suffix = endOfDay ? 'T23:59:59Z' : 'T00:00:00Z';
  return Math.floor(new Date(`${iso.slice(0, 10)}${suffix}`).getTime() / 1000);
}

function toIsoDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function configuredProviders(): ExternalStockQuoteProviderName[] {
  const raw = process.env.INVEST_STOCK_QUOTE_PROVIDERS ||
    'yahoo_finance,stooq,statusinvest,investidor10';
  const allowed = new Set<ExternalStockQuoteProviderName>([
    'yahoo_finance',
    'stooq',
    'statusinvest',
    'investidor10',
  ]);
  const providers = raw
    .split(',')
    .map((p) => p.trim().toLowerCase() as ExternalStockQuoteProviderName)
    .filter((p) => allowed.has(p));
  return providers.length ? providers : ['yahoo_finance'];
}

function moneyFromPtBr(value: string): number | null {
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uniqueByDate(rows: ExternalStockQuoteResult[]): ExternalStockQuoteResult[] {
  const byDate = new Map<string, ExternalStockQuoteResult>();
  for (const row of rows) {
    if (!byDate.has(row.asOf)) byDate.set(row.asOf, row);
  }
  return [...byDate.values()].sort((a, b) => a.asOf.localeCompare(b.asOf));
}

async function fetchYahooBars(
  ticker: string,
  from: string,
  to: string
): Promise<ExternalStockQuoteResult[]> {
  const symbol = `${ticker.trim().toUpperCase()}.SA`;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${toUnixSeconds(from)}&period2=${toUnixSeconds(to, true)}&interval=1d`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  }
  const json = (await res.json()) as YahooChartResult;
  const result = json.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out: ExternalStockQuoteResult[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    out.push({
      ticker: ticker.trim().toUpperCase(),
      price: Math.round(close * 10000) / 10000,
      asOf: toIsoDate(stamps[i]!),
      source: 'yahoo_finance',
      kind: 'close',
    });
  }
  return out;
}

async function fetchStooqBars(
  ticker: string,
  from: string,
  to: string
): Promise<ExternalStockQuoteResult[]> {
  const symbolCandidates = [
    `${ticker.trim().toLowerCase()}.br`,
    `${ticker.trim().toLowerCase()}.sa`,
  ];
  const fromParam = from.replace(/-/g, '');
  const toParam = to.replace(/-/g, '');
  for (const symbol of symbolCandidates) {
    const url =
      `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}` +
      `&d1=${fromParam}&d2=${toParam}&i=d`;
    const res = await fetch(url, {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) continue;
    const csv = await res.text();
    const rows: ExternalStockQuoteResult[] = [];
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const [date, , , , close] = line.split(',');
      const price = Number(close);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;
      if (!Number.isFinite(price) || price <= 0) continue;
      rows.push({
        ticker: ticker.trim().toUpperCase(),
        price: Math.round(price * 10000) / 10000,
        asOf: date,
        source: 'stooq',
        kind: 'close',
      });
    }
    if (rows.length) return rows;
  }
  return [];
}

async function fetchHtmlProviderQuote(
  provider: 'statusinvest' | 'investidor10',
  ticker: string,
  asOfDate: string
): Promise<ExternalStockQuoteResult | null> {
  const symbol = ticker.trim().toLowerCase();
  const url =
    provider === 'statusinvest'
      ? `https://statusinvest.com.br/acoes/${encodeURIComponent(symbol)}`
      : `https://investidor10.com.br/acoes/${encodeURIComponent(symbol)}/`;
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 CO-CEO quote sync',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const day = asOfDate.slice(0, 10);
  const brDay = `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  const candidates = [
    new RegExp(`${day}[^0-9]{1,80}([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2})`, 'i'),
    new RegExp(`${brDay}[^0-9]{1,80}([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2})`, 'i'),
  ];
  for (const re of candidates) {
    const match = html.match(re);
    const price = match?.[1] ? moneyFromPtBr(match[1]) : null;
    if (price) {
      return {
        ticker: ticker.trim().toUpperCase(),
        price: Math.round(price * 10000) / 10000,
        asOf: day,
        source: provider,
        kind: 'close',
      };
    }
  }
  return null;
}

async function fetchProviderHistory(
  provider: ExternalStockQuoteProviderName,
  ticker: string,
  from: string,
  to: string
): Promise<ExternalStockQuoteResult[]> {
  if (provider === 'yahoo_finance') return fetchYahooBars(ticker, from, to);
  if (provider === 'stooq') return fetchStooqBars(ticker, from, to);
  // StatusInvest/Investidor10 are used as per-day HTML fallbacks; their pages do
  // not expose a stable public CSV API in this codebase yet.
  if (from === to) {
    const single = await fetchHtmlProviderQuote(provider, ticker, from);
    return single ? [single] : [];
  }
  return [];
}

export async function fetchYahooStockQuoteForDate(
  ticker: string,
  asOfDate: string
): Promise<ExternalStockQuoteResult | null> {
  const day = asOfDate.slice(0, 10);
  const bars = await fetchYahooBars(ticker, day, day);
  return bars.find((b) => b.asOf === day) ?? null;
}

export async function fetchYahooStockHistory(
  ticker: string,
  from: string,
  to: string
): Promise<ExternalStockQuoteResult[]> {
  return fetchYahooBars(ticker, from.slice(0, 10), to.slice(0, 10));
}

export async function fetchExternalStockQuoteForDate(
  ticker: string,
  asOfDate: string
): Promise<ExternalStockQuoteResult | null> {
  const day = asOfDate.slice(0, 10);
  for (const provider of configuredProviders()) {
    try {
      const rows = await fetchProviderHistory(provider, ticker, day, day);
      const hit = rows.find((r) => r.asOf === day);
      if (hit) return hit;
    } catch {
      // Try the next provider. A stock quote is mandatory, but one provider
      // failing should not stop the search chain.
    }
  }
  return null;
}

export async function fetchExternalStockHistory(
  ticker: string,
  from: string,
  to: string
): Promise<ExternalStockQuoteResult[]> {
  const byDate = new Map<string, ExternalStockQuoteResult>();
  for (const provider of configuredProviders()) {
    try {
      const rows = await fetchProviderHistory(provider, ticker, from.slice(0, 10), to.slice(0, 10));
      for (const row of rows) {
        if (row.asOf < from || row.asOf > to) continue;
        if (!byDate.has(row.asOf)) byDate.set(row.asOf, row);
      }
    } catch {
      // Keep walking the chain until all configured sources are exhausted.
    }
  }
  return uniqueByDate([...byDate.values()]);
}
