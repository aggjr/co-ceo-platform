import { inferAssetType, inferUnderlyingTicker, isOptionTicker } from './assetClassifier';
import { fetchOpcoesNetOptionsChainAll } from './opcoesNetClient';
import { parseOpcoesNetExpirations } from './opcoesNetChainParser';
import { fetchB3Quotes } from './B3QuoteProvider';
import { inferOptionExpiryDate } from './optionExpiry';
import type { QuoteSource } from '../market/MarketQuoteRepository';
import {
  fetchExternalStockQuoteForDate,
  fetchYahooStockQuoteForDate,
  type ExternalStockQuoteProviderName,
} from '../market/ExternalStockQuoteProvider';

export type OpcoesNetOptionQuote = {
  ticker: string;
  price: number;
  asOf: string;
  /** Dados do contrato — disponíveis diretamente da grade opcoes.net */
  strikePrice: number | null;
  expirationDate: string | null;
  optionType: 'CALL' | 'PUT' | null;
  underlyingTicker: string | null;
};

/**
 * Cotação do último negócio na grade opcoes.net (dia anterior / última sessão).
 * Agrupa por ação-mãe para uma chamada de cadeia por subjacente.
 */
export async function fetchOpcoesNetOptionQuotes(
  optionTickers: string[],
  options?: { asOfDate?: string; delayMs?: number }
): Promise<OpcoesNetOptionQuote[]> {
  const wanted = new Set(
    optionTickers.map((t) => t.trim().toUpperCase()).filter((t) => t && isOptionTicker(t))
  );
  if (!wanted.size) return [];

  const byUnderlying = new Map<string, Set<string>>();
  for (const ticker of wanted) {
    const und = inferUnderlyingTicker(ticker);
    if (!und) continue;
    if (!byUnderlying.has(und)) byUnderlying.set(und, new Set());
    byUnderlying.get(und)!.add(ticker);
  }

  const fallbackAsOf = options?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const delayMs = options?.delayMs ?? 300;
  const out: OpcoesNetOptionQuote[] = [];
  const found = new Set<string>();

  for (const [underlying, tickers] of byUnderlying) {
    try {
      const expirations = await fetchOpcoesNetOptionsChainAll(underlying);
      const parsed = parseOpcoesNetExpirations(underlying, expirations, '2000-01-01');
      for (const row of parsed) {
        if (!tickers.has(row.ticker) || found.has(row.ticker)) continue;
        const price = row.lastPrice;
        if (price == null || price < 0) continue;
        out.push({
          ticker: row.ticker,
          price,
          asOf: row.quoteDate ?? fallbackAsOf,
          strikePrice: row.strikePrice,
          expirationDate: row.expirationDate,
          optionType: row.optionType,
          underlyingTicker: underlying,
        });
        found.add(row.ticker);
      }
    } catch {
      /* subjacente indisponível na API */
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return out;
}

export type ExternalOptionQuoteProviderName =
  | 'brapi'
  | 'yahoo_finance'
  | 'stooq'
  | 'statusinvest';

export type OptionQuoteWithSource = OpcoesNetOptionQuote & {
  source: QuoteSource;
  provider?: string;
};

function configuredFallbackProviders(): ExternalOptionQuoteProviderName[] {
  const raw =
    process.env.INVEST_OPTION_QUOTE_FALLBACK_PROVIDERS || 'brapi,yahoo_finance,stooq,statusinvest';
  const allowed = new Set<ExternalOptionQuoteProviderName>([
    'brapi',
    'yahoo_finance',
    'stooq',
    'statusinvest',
  ]);
  const providers = raw
    .split(',')
    .map((p) => p.trim().toLowerCase() as ExternalOptionQuoteProviderName)
    .filter((p) => allowed.has(p));
  return providers.length ? providers : ['brapi', 'yahoo_finance', 'stooq', 'statusinvest'];
}

function moneyFromPtBr(value: string): number | null {
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function optionTypeFromTicker(ticker: string): 'CALL' | 'PUT' | null {
  const type = inferAssetType(ticker);
  if (type === 'option_call') return 'CALL';
  if (type === 'option_put') return 'PUT';
  return null;
}

function mapStockFallback(
  ticker: string,
  row: { price: number; asOf: string; source: ExternalStockQuoteProviderName | string },
  underlying: string | null
): OptionQuoteWithSource {
  return {
    ticker: ticker.trim().toUpperCase(),
    price: row.price,
    asOf: row.asOf.slice(0, 10),
    strikePrice: null,
    expirationDate: inferOptionExpiryDate(ticker),
    optionType: optionTypeFromTicker(ticker),
    underlyingTicker: underlying,
    source: row.source === 'brapi' ? 'brapi' : 'yahoo_finance',
    provider: String(row.source),
  };
}

async function fetchBrapiOptionQuote(
  ticker: string,
  asOfDate: string
): Promise<OptionQuoteWithSource | null> {
  const quotes = await fetchB3Quotes([ticker], {
    asOfDate,
    token: process.env.BRAPI_TOKEN,
  });
  const hit = quotes.find((q) => q.ticker === ticker.trim().toUpperCase());
  if (!hit || hit.price == null || hit.price < 0) return null;
  return mapStockFallback(
    ticker,
    { price: hit.price, asOf: hit.asOf, source: 'brapi' },
    inferUnderlyingTicker(ticker)
  );
}

async function fetchYahooOptionQuote(
  ticker: string,
  asOfDate: string
): Promise<OptionQuoteWithSource | null> {
  const hit = await fetchYahooStockQuoteForDate(ticker, asOfDate);
  if (!hit) return null;
  return mapStockFallback(ticker, hit, inferUnderlyingTicker(ticker));
}

async function fetchStooqOptionQuote(
  ticker: string,
  asOfDate: string
): Promise<OptionQuoteWithSource | null> {
  const hit = await fetchExternalStockQuoteForDate(ticker, asOfDate);
  if (!hit || hit.source !== 'stooq') return null;
  return mapStockFallback(ticker, hit, inferUnderlyingTicker(ticker));
}

async function fetchStatusInvestOptionQuote(
  ticker: string,
  asOfDate: string
): Promise<OptionQuoteWithSource | null> {
  const clean = ticker.trim().toUpperCase();
  const underlying = inferUnderlyingTicker(clean);
  if (!underlying) return null;
  const url = `https://statusinvest.com.br/opcoes/${underlying.toLowerCase()}/${clean.toLowerCase()}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 CO-CEO option quote sync',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const pricePattern = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i;
  const premiumMatch =
    html.match(
      new RegExp(`Pr[eê]mio atual[\\s\\S]{0,400}?${pricePattern.source}`, 'i')
    ) ||
    html.match(
      new RegExp(`Cota[cç][aã]o do pr[eê]mio[\\s\\S]{0,600}?${pricePattern.source}`, 'i')
    ) ||
    html.match(
      new RegExp(`###\\s*Pr[eê]mio atual[\\s\\S]{0,120}?${pricePattern.source}`, 'i')
    );
  const price = premiumMatch?.[1] ? moneyFromPtBr(premiumMatch[1]) : null;
  if (price == null) return null;
  return {
    ticker: clean,
    price: Math.round(price * 10000) / 10000,
    asOf: asOfDate.slice(0, 10),
    strikePrice: null,
    expirationDate: inferOptionExpiryDate(clean),
    optionType: optionTypeFromTicker(clean),
    underlyingTicker: underlying,
    source: 'yahoo_finance',
    provider: 'statusinvest',
  };
}

async function fetchFallbackOptionQuoteForDate(
  ticker: string,
  asOfDate: string
): Promise<OptionQuoteWithSource | null> {
  const day = asOfDate.slice(0, 10);
  for (const provider of configuredFallbackProviders()) {
    try {
      let hit: OptionQuoteWithSource | null = null;
      if (provider === 'brapi') hit = await fetchBrapiOptionQuote(ticker, day);
      else if (provider === 'yahoo_finance') hit = await fetchYahooOptionQuote(ticker, day);
      else if (provider === 'stooq') hit = await fetchStooqOptionQuote(ticker, day);
      else if (provider === 'statusinvest') hit = await fetchStatusInvestOptionQuote(ticker, day);
      if (hit) return hit;
    } catch {
      /* tenta proxima fonte */
    }
  }
  return null;
}

/** opcoes.net primeiro; tickers faltantes percorrem fontes web configuradas. */
export async function fetchOptionQuotesWithFallback(
  optionTickers: string[],
  options?: { asOfDate?: string; delayMs?: number }
): Promise<OptionQuoteWithSource[]> {
  const asOfDate = (options?.asOfDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const primary = await fetchOpcoesNetOptionQuotes(optionTickers, options);
  const out: OptionQuoteWithSource[] = primary.map((q) => ({ ...q, source: 'opcoes_net' }));
  const found = new Set(out.map((q) => q.ticker));
  const missing = [
    ...new Set(
      optionTickers.map((t) => t.trim().toUpperCase()).filter((t) => t && !found.has(t))
    ),
  ];

  for (const ticker of missing) {
    const fallback = await fetchFallbackOptionQuoteForDate(ticker, asOfDate);
    if (fallback) out.push(fallback);
    if ((options?.delayMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, options!.delayMs));
    }
  }
  return out;
}

export async function fetchExternalOptionQuoteForDate(
  ticker: string,
  asOfDate: string
): Promise<OptionQuoteWithSource | null> {
  const day = asOfDate.slice(0, 10);
  const fromOpcoes = await fetchOpcoesNetOptionQuotes([ticker], { asOfDate: day });
  const hit = fromOpcoes.find((q) => q.ticker === ticker.trim().toUpperCase());
  if (hit) return { ...hit, source: 'opcoes_net' };
  return fetchFallbackOptionQuoteForDate(ticker, day);
}
