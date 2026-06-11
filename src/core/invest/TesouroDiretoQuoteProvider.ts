import type { QuoteSource } from '../market/MarketQuoteRepository';
import { estimateLftVna } from './lftVnaEstimator';

export type TesouroDiretoQuoteKind = 'tesouro_close' | 'tesouro_estimated_lft';

export type TesouroDiretoQuote = {
  ticker: string;
  price: number;
  asOf: string;
  source: QuoteSource;
  kind: TesouroDiretoQuoteKind;
  provider: string;
};

export type FetchTesouroDiretoQuotesOptions = {
  asOfDate?: string;
  historicalCsvUrls?: string[];
  fetchImpl?: typeof fetch;
  fallbackLft?: boolean;
  lftRefDate?: string;
  lftRefVna?: number;
  lftSelicAnual?: number;
};

type TesouroCsvRow = {
  tipoTitulo: string;
  vencimento: string;
  dataBase: string;
  price: number;
};

type CkanSearchResponse = {
  result?: {
    results?: Array<{
      resources?: Array<{
        format?: string;
        mimetype?: string;
        name?: string;
        url?: string;
      }>;
    }>;
  };
};

const CKAN_PACKAGE_SEARCH_URL =
  'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_search' +
  '?q=Precos%20e%20taxas%20dos%20titulos%20publicos%20Tesouro%20Direto&rows=10';

const DEFAULT_LFT_REF_DATE = '2026-01-01';
const DEFAULT_LFT_REF_VNA = 1_000_341.65;
const DEFAULT_LFT_SELIC_ANUAL = 0.1475;

function cleanTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isoDate(value: string): string {
  const raw = String(value || '').trim();
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .toUpperCase();
}

function parsePtBrNumber(value: string | undefined): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function splitCsvLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === separator && !quoted) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function headerIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeText);
  const wanted = candidates.map(normalizeText);
  const exact = normalized.findIndex((h) => wanted.some((w) => h === w));
  if (exact >= 0) return exact;
  return normalized.findIndex((h) => wanted.some((w) => h.includes(w)));
}

function preferredPrice(row: string[], headers: string[]): number | null {
  const candidates = [
    'PU Base Manha',
    'PU Venda Manha',
    'PU Compra Manha',
    'Preco Unitario Venda',
    'Preco Unitario Compra',
    'Valor Base',
    'PU',
  ];
  for (const candidate of candidates) {
    const idx = headerIndex(headers, [candidate]);
    const price = idx >= 0 ? parsePtBrNumber(row[idx]) : null;
    if (price) return Math.round(price * 100) / 100;
  }
  return null;
}

export function parseTesouroDiretoCsv(csv: string): TesouroCsvRow[] {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const separator = (lines[0]!.match(/;/g)?.length || 0) >= (lines[0]!.match(/,/g)?.length || 0) ? ';' : ',';
  const headers = splitCsvLine(lines[0]!, separator);
  const typeIdx = headerIndex(headers, ['Tipo Titulo', 'Titulo']);
  const maturityIdx = headerIndex(headers, ['Data Vencimento', 'Vencimento']);
  const dateIdx = headerIndex(headers, ['Data Base']);
  if (typeIdx < 0 || maturityIdx < 0 || dateIdx < 0) return [];

  const rows: TesouroCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line, separator);
    const price = preferredPrice(cols, headers);
    const dataBase = isoDate(cols[dateIdx] || '');
    const vencimento = isoDate(cols[maturityIdx] || '');
    const tipoTitulo = String(cols[typeIdx] || '').trim();
    if (!tipoTitulo || !vencimento || !dataBase || !price) continue;
    rows.push({ tipoTitulo, vencimento, dataBase, price });
  }
  return rows;
}

function parseTicker(ticker: string): { normalized: string; maturity: string; titleFamily: string } | null {
  const normalized = cleanTicker(ticker);
  const lft = normalized.match(/^LFT-(\d{4})(\d{2})(\d{2})$/);
  if (lft) {
    return { normalized, maturity: `${lft[1]}-${lft[2]}-${lft[3]}`, titleFamily: 'SELIC' };
  }
  const withYear = normalized.match(/^TESOURO-([A-Z]+)-(\d{4})$/);
  if (withYear) {
    return { normalized, maturity: withYear[2]!, titleFamily: withYear[1]! };
  }
  return null;
}

function rowMatchesTicker(row: TesouroCsvRow, parsed: NonNullable<ReturnType<typeof parseTicker>>): boolean {
  const title = normalizeText(row.tipoTitulo);
  if (parsed.titleFamily === 'SELIC') {
    if (!title.includes('SELIC') && !title.includes('LFT')) return false;
  } else if (parsed.titleFamily === 'IPCA') {
    if (!title.includes('IPCA') && !title.includes('NTN B')) return false;
  } else if (parsed.titleFamily === 'PREFIXADO' || parsed.titleFamily === 'PRE') {
    if (!title.includes('PREFIXADO') && !title.includes('LTN') && !title.includes('NTN F')) return false;
  } else {
    return false;
  }
  return row.vencimento === parsed.maturity || row.vencimento.startsWith(`${parsed.maturity}-`);
}

function configuredCsvUrls(options: FetchTesouroDiretoQuotesOptions): string[] {
  if (options.historicalCsvUrls) return options.historicalCsvUrls;
  return (process.env.TESOURO_DIRETO_HISTORICAL_CSV_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

async function discoverCsvUrls(fetchImpl: typeof fetch): Promise<string[]> {
  const res = await fetchImpl(CKAN_PACKAGE_SEARCH_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as CkanSearchResponse;
  const urls: string[] = [];
  for (const pkg of json.result?.results || []) {
    for (const resource of pkg.resources || []) {
      const url = String(resource.url || '');
      const fmt = normalizeText(`${resource.format || ''} ${resource.mimetype || ''} ${resource.name || ''}`);
      if (!url || !/^https:\/\//i.test(url)) continue;
      if (fmt.includes('CSV') || url.toLowerCase().includes('.csv')) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

async function loadHistoricalRows(options: FetchTesouroDiretoQuotesOptions): Promise<TesouroCsvRow[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const urls = configuredCsvUrls(options);
  if (!urls.length) {
    try {
      urls.push(...(await discoverCsvUrls(fetchImpl)));
    } catch {
      return [];
    }
  }

  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'text/csv,text/plain,*/*' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) continue;
      const rows = parseTesouroDiretoCsv(await res.text());
      if (rows.length) return rows;
    } catch {
      // Keep the quote sync resilient; the LFT estimator below is the required fallback.
    }
  }
  return [];
}

function estimateLftQuote(
  ticker: string,
  asOf: string,
  options: FetchTesouroDiretoQuotesOptions
): TesouroDiretoQuote | null {
  const parsed = parseTicker(ticker);
  if (!parsed || parsed.titleFamily !== 'SELIC') return null;
  const refDate = (options.lftRefDate || process.env.TESOURO_LFT_REF_DATE || DEFAULT_LFT_REF_DATE).slice(0, 10);
  const refVna = Number(options.lftRefVna ?? process.env.TESOURO_LFT_REF_VNA ?? DEFAULT_LFT_REF_VNA);
  const selicAnual = Number(
    options.lftSelicAnual ?? process.env.TESOURO_LFT_SELIC_ANUAL ?? DEFAULT_LFT_SELIC_ANUAL
  );
  if (!Number.isFinite(refVna) || refVna <= 0 || !Number.isFinite(selicAnual) || selicAnual <= 0) {
    return null;
  }
  return {
    ticker: parsed.normalized,
    price: Math.round(estimateLftVna(refDate, refVna, asOf, selicAnual) * 100) / 100,
    asOf,
    source: 'computed_cdi',
    kind: 'tesouro_estimated_lft',
    provider: `lftVnaEstimator:${refDate}`,
  };
}

export async function fetchTesouroDiretoQuotes(
  tickers: string[],
  options: FetchTesouroDiretoQuotesOptions = {}
): Promise<TesouroDiretoQuote[]> {
  const asOf = (options.asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const unique = [...new Set(tickers.map(cleanTicker).filter(Boolean))];
  if (!unique.length) return [];

  const out: TesouroDiretoQuote[] = [];
  const found = new Set<string>();
  const rows = await loadHistoricalRows(options);
  for (const ticker of unique) {
    const parsed = parseTicker(ticker);
    if (!parsed) continue;
    const match = rows
      .filter((row) => row.dataBase === asOf && rowMatchesTicker(row, parsed))
      .sort((a, b) => a.tipoTitulo.localeCompare(b.tipoTitulo))[0];
    if (!match) continue;
    out.push({
      ticker: parsed.normalized,
      price: match.price,
      asOf,
      source: 'tesouro_direto',
      kind: 'tesouro_close',
      provider: 'tesouro_transparente_csv',
    });
    found.add(parsed.normalized);
  }

  if (options.fallbackLft !== false) {
    for (const ticker of unique) {
      if (found.has(ticker)) continue;
      const estimated = estimateLftQuote(ticker, asOf, options);
      if (estimated) out.push(estimated);
    }
  }

  return out;
}
