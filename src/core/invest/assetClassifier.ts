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

/** Ticker da ação mãe para opções: explicit > catalogo DB > heuristica B3 (root+3/11). */
export function inferUnderlyingTicker(
  ticker: string,
  explicit?: string,
  catalog?: Map<string, string>
): string {
  if (explicit?.trim()) return explicit.trim().toUpperCase();
  const t = ticker.trim().toUpperCase();
  const fromCatalog = catalog?.get(t);
  if (fromCatalog) return fromCatalog;
  const assetType = inferAssetType(t);
  if (assetType === 'option_call' || assetType === 'option_put') {
    const root = t.slice(0, 4);
    return root + (t.endsWith('11') ? '11' : '3');
  }
  return t;
}
