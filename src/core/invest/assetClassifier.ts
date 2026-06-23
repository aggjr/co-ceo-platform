export function isFixedIncomeTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return (
    t.startsWith('TESOURO-') ||
    t.startsWith('CDB-') ||
    t.startsWith('LFT-') ||
    t.startsWith('TD-')
  );
}

export function isOptionTicker(ticker: string): boolean {
  const t = inferAssetType(ticker);
  return t === 'option_call' || t === 'option_put';
}

/** Inferência simples de tipo de ativo pelo ticker B3. */
export function inferAssetType(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (!t) return 'stock';
  if (t.startsWith('CAIXA-') || t === 'CAIXA') return 'cash';
  if (isFixedIncomeTicker(t)) return 'fixed_income';
  if (/^[A-Z]{4}11$/.test(t)) return 'fii';
  if (/^[A-Z]{4}[3-8]$/.test(t)) return 'stock';
  if (!t.includes('-') && t.length >= 6 && /^[A-Z]{4}[A-X]\d/.test(t)) {
    const optLetter = t.charAt(4);
    if (optLetter >= 'A' && optLetter <= 'L') return 'option_call';
    if (optLetter >= 'M' && optLetter <= 'X') return 'option_put';
  }
  return 'stock';
}

/**
 * Estrutura de mercado B3: raizes cujas opcoes padronizadas liquidam na acao
 * preferencial (…4), nao na ordinaria (…3). Referencia de mercado (nao default
 * de cliente) — a fonte autoritativa e o catalogo da cadeia de opcoes (param `catalog`).
 */
const B3_OPTION_UNDERLYING_BY_ROOT: Record<string, string> = {
  ITUB: 'ITUB4',
};

/**
 * Ticker da acao mae para opcoes.
 * Precedencia: catalogo DB > referencia de mercado B3 (corrige …3 errado para …4)
 * > explicit do lancamento > heuristica B3 (root+3/11).
 */
export function inferUnderlyingTicker(
  ticker: string,
  explicit?: string,
  catalog?: Map<string, string>
): string {
  const t = ticker.trim().toUpperCase();
  const assetType = inferAssetType(t);
  const isOption = assetType === 'option_call' || assetType === 'option_put';

  if (isOption) {
    const marketUnderlying = B3_OPTION_UNDERLYING_BY_ROOT[t.slice(0, 4)];
    if (marketUnderlying) return marketUnderlying;
  }

  if (explicit?.trim()) return explicit.trim().toUpperCase();

  const fromCatalog = catalog?.get(t);
  if (fromCatalog) return fromCatalog;

  if (isOption) {
    const root = t.slice(0, 4);
    return root + (t.endsWith('11') ? '11' : '3');
  }
  return t;
}
