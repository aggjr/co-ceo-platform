import { inferUnderlyingTicker, isOptionTicker } from './assetClassifier';
import { fetchOpcoesNetOptionsChainAll } from './opcoesNetClient';
import { parseOpcoesNetExpirations } from './opcoesNetChainParser';

export type OpcoesNetOptionQuote = {
  ticker: string;
  price: number;
  asOf: string;
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
