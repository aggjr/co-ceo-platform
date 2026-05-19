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

/** Busca cotações em lotes (máx. ~20 tickers por request). */
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
  const results: B3QuoteResult[] = [];

  for (const batch of chunk(unique, 18)) {
    const symbols = batch.join(',');
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (needsHistory) {
      params.set('range', '1mo');
      params.set('interval', '1d');
    }

    const url = `${base}/quote/${encodeURIComponent(symbols)}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`brapi HTTP ${res.status} (${symbols}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { results?: BrapiQuoteRow[] };
    for (const row of json.results || []) {
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
  }

  return results;
}
