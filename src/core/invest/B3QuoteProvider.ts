/**
 * Cotações B3 via brapi.dev (ações, FIIs).
 * Opções: ainda dependem do snapshot BTG/Necton (sem fonte pública confiável no plano gratuito).
 */

export type B3QuoteResult = {
  ticker: string;
  price: number;
  asOf: string;
  source: 'brapi';
  /** Fechamento do pregão vs último preço disponível. */
  kind: 'close' | 'last';
};

export type FetchB3QuotesOptions = {
  /** Data do fechamento desejado (YYYY-MM-DD). Se omitido, usa último pregão disponível. */
  asOfDate?: string;
  token?: string;
  baseUrl?: string;
};

const DEFAULT_BASE = 'https://brapi.dev/api';

type BrapiHistoricalBar = {
  date: number;
  close: number;
};

type BrapiQuoteRow = {
  symbol: string;
  regularMarketPrice?: number;
  historicalDataPrice?: BrapiHistoricalBar[];
};

function utcDateFromUnixSeconds(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function pickCloseForDate(row: BrapiQuoteRow, asOfDate: string): number | null {
  const bars = row.historicalDataPrice;
  if (!bars?.length) return null;
  let match: BrapiHistoricalBar | undefined;
  for (const bar of bars) {
    const d = utcDateFromUnixSeconds(bar.date);
    if (d === asOfDate) match = bar;
  }
  if (match && Number.isFinite(match.close)) return match.close;
  const before = bars
    .filter((b) => utcDateFromUnixSeconds(b.date) <= asOfDate)
    .sort((a, b) => b.date - a.date)[0];
  return before && Number.isFinite(before.close) ? before.close : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function tickersPerRequest(): number {
  const n = Number(process.env.BRAPI_TICKERS_PER_REQUEST);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  // Plano gratuito brapi: 1 ativo por requisição (lote maior retorna HTTP 400).
  return 1;
}

function requestDelayMs(): number {
  const n = Number(process.env.BRAPI_REQUEST_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : 400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseQuoteRows(
  rows: BrapiQuoteRow[],
  asOfDate: string | undefined
): B3QuoteResult[] {
  const results: B3QuoteResult[] = [];
  for (const row of rows) {
    const ticker = String(row.symbol || '').toUpperCase();
    if (!ticker) continue;

    let price: number | null = null;
    let kind: 'close' | 'last' = 'last';
    let asOf = asOfDate || new Date().toISOString().slice(0, 10);

    if (asOfDate) {
      const close = pickCloseForDate(row, asOfDate);
      if (close != null) {
        price = close;
        kind = 'close';
        asOf = asOfDate;
      }
    }
    if (price == null) {
      const last = Number(row.regularMarketPrice);
      if (Number.isFinite(last) && last > 0) {
        price = last;
        kind = 'last';
      }
    }
    if (price == null) continue;

    results.push({
      ticker,
      price: Math.round(price * 10000) / 10000,
      asOf,
      source: 'brapi',
      kind,
    });
  }
  return results;
}

async function fetchBrapiBatch(
  batch: string[],
  options: {
    base: string;
    token: string;
    asOfDate?: string;
    needsHistory: boolean;
  }
): Promise<B3QuoteResult[]> {
  const symbols = batch.join(',');
  const params = new URLSearchParams();
  if (options.token) params.set('token', options.token);
  if (options.needsHistory) {
    params.set('range', '1mo');
    params.set('interval', '1d');
  }

  const url = `${options.base}/quote/${encodeURIComponent(symbols)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  const bodyText = await res.text().catch(() => '');
  let json: { results?: BrapiQuoteRow[]; message?: string };
  try {
    json = JSON.parse(bodyText) as { results?: BrapiQuoteRow[]; message?: string };
  } catch {
    json = {};
  }

  if (!res.ok) {
    const msg = json.message || bodyText.slice(0, 200);
    if (batch.length === 1 && (res.status === 404 || /opções|options/i.test(msg))) {
      return [];
    }
    const planLimit = res.status === 400 && /máximo\s+1\s+ativo/i.test(msg);
    if (planLimit && batch.length > 1) {
      const out: B3QuoteResult[] = [];
      for (const ticker of batch) {
        out.push(...(await fetchBrapiBatch([ticker], options)));
        await sleep(requestDelayMs());
      }
      return out;
    }
    throw new Error(`brapi HTTP ${res.status} (${symbols}): ${msg}`);
  }

  return parseQuoteRows(json.results || [], options.asOfDate);
}

/** Busca cotações na brapi (1 ticker/request no plano gratuito). */
export async function fetchB3Quotes(
  tickers: string[],
  options: FetchB3QuotesOptions = {}
): Promise<B3QuoteResult[]> {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (!unique.length) return [];

  const base = (options.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const token = options.token || process.env.BRAPI_TOKEN || '';
  const asOfDate = options.asOfDate?.slice(0, 10);
  const needsHistory = Boolean(asOfDate);
  const batchSize = tickersPerRequest();
  const results: B3QuoteResult[] = [];

  const batches = chunk(unique, batchSize);
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(requestDelayMs());
    results.push(
      ...(await fetchBrapiBatch(batches[i]!, {
        base,
        token,
        asOfDate,
        needsHistory,
      }))
    );
  }

  return results;
}
