import type { OpcoesNetChainRow, OpcoesNetExpiration } from './opcoesNetClient';
import type { OptionMarketRow } from './optionMarketCatalog';

/** Sufixo opcoes.net (ex. R407) + ação mãe → ticker B3 (PRIOR407). */
export function b3OptionTickerFromOpcoesNetSuffix(
  underlyingTicker: string,
  opcoesNetSuffix: string
): string {
  const root = underlyingTicker.trim().toUpperCase().slice(0, 4);
  const suffix = String(opcoesNetSuffix ?? '')
    .trim()
    .toUpperCase();
  if (!root || !suffix) return '';
  return root + suffix;
}

export type ParsedOptionMarketRow = OptionMarketRow & {
  europeanAmerican: 'E' | 'A';
  /** Último negócio (coluna "p" da grade opcoes.net). */
  lastPrice: number | null;
  quoteDate: string | null;
};

/** Índices do array OptionsChain (colunas id: suffix, fm, m, s, aio, distancia_do_strike, p, …). */
const CHAIN_LAST_PRICE_IDX = 6;
const CHAIN_QUOTE_DATE_IDX = 8;

function parseQuoteDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseChainRow(
  row: OpcoesNetChainRow,
  underlyingTicker: string,
  optionType: 'CALL' | 'PUT',
  expirationDate: string
): ParsedOptionMarketRow | null {
  if (!Array.isArray(row) || row.length < 4) return null;
  const suffix = String(row[0] ?? '').trim();
  const strike = Number(row[3]);
  if (!suffix || !Number.isFinite(strike) || strike <= 0) return null;

  const ticker = b3OptionTickerFromOpcoesNetSuffix(underlyingTicker, suffix);
  if (!ticker) return null;

  const style = String(row[2] ?? 'E').toUpperCase() === 'A' ? 'A' : 'E';
  const lastRaw = row.length > CHAIN_LAST_PRICE_IDX ? Number(row[CHAIN_LAST_PRICE_IDX]) : Number.NaN;
  const lastPrice =
    Number.isFinite(lastRaw) && lastRaw >= 0 ? Math.round(lastRaw * 10000) / 10000 : null;
  const quoteDate =
    row.length > CHAIN_QUOTE_DATE_IDX ? parseQuoteDate(row[CHAIN_QUOTE_DATE_IDX]) : null;

  return {
    ticker,
    underlyingTicker: underlyingTicker.trim().toUpperCase(),
    optionType,
    strikePrice: Math.round(strike * 10000) / 10000,
    expirationDate: expirationDate.slice(0, 10),
    europeanAmerican: style,
    lastPrice,
    quoteDate,
  };
}

export function parseOpcoesNetExpirations(
  underlyingTicker: string,
  expirations: OpcoesNetExpiration[],
  asOfDate = new Date().toISOString().slice(0, 10)
): ParsedOptionMarketRow[] {
  const underlying = underlyingTicker.trim().toUpperCase();
  const out: ParsedOptionMarketRow[] = [];
  const seen = new Set<string>();

  for (const exp of expirations) {
    const expirationDate = String(exp.dt ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) continue;
    if (expirationDate < asOfDate) continue;

    for (const row of exp.calls ?? []) {
      const parsed = parseChainRow(row, underlying, 'CALL', expirationDate);
      if (!parsed || seen.has(parsed.ticker)) continue;
      seen.add(parsed.ticker);
      out.push(parsed);
    }
    for (const row of exp.puts ?? []) {
      const parsed = parseChainRow(row, underlying, 'PUT', expirationDate);
      if (!parsed || seen.has(parsed.ticker)) continue;
      seen.add(parsed.ticker);
      out.push(parsed);
    }
  }

  return out;
}
