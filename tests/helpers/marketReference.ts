/**
 * Referências externas para paridade (visão do usuário).
 * Live: BRAPI_TOKEN + PARITY_LIVE_MARKET=1 (CI pode pular).
 */
import { fetchB3Quotes } from '../../src/core/invest/B3QuoteProvider';

export const PARITY_LIVE =
  process.env.PARITY_LIVE_MARKET === '1' && Boolean(process.env.BRAPI_TOKEN?.trim());

export const REFERENCE_TICKERS = ['PRIO3', 'PETR4'] as const;

export async function fetchReferenceEquityQuote(ticker: string, asOfDate?: string) {
  const rows = await fetchB3Quotes([ticker], {
    asOfDate,
    token: process.env.BRAPI_TOKEN,
  });
  const row = rows.find((r) => r.ticker === ticker.toUpperCase());
  if (!row || !Number.isFinite(row.price) || row.price <= 0) {
    throw new Error(`brapi sem cotação válida para ${ticker}`);
  }
  return row;
}

/** Tolerância relativa para pregão vs último (mercado em tempo real). */
export function quotesWithinTolerance(
  systemPrice: number,
  referencePrice: number,
  relativePct = 0.02
): boolean {
  if (!Number.isFinite(systemPrice) || !Number.isFinite(referencePrice)) return false;
  if (referencePrice <= 0) return false;
  const diff = Math.abs(systemPrice - referencePrice) / referencePrice;
  return diff <= relativePct;
}
