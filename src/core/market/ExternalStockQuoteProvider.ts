export type ExternalStockQuoteResult = {
  ticker: string;
  price: number;
  asOf: string;
  source: 'yahoo_finance';
  kind: 'close';
};

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
