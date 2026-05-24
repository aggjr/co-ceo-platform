/**
 * Resolucao de valores de dominio (ex.: TIPO na coluna de historico) via manifesto UI.
 * Codigo canonico (CALL, PUT, LFT...) -> text_key no catalogo -> label + estilo.
 */

/** Codigo retornado por resolveTradeType -> chave no ui_text_catalog */
export const TRADE_TYPE_TEXT_KEY = {
  CALL: 'value.invest.trade_type.call',
  PUT: 'value.invest.trade_type.put',
  EXEC: 'value.invest.trade_type.exec',
  BTC: 'value.invest.trade_type.btc',
  LFT: 'value.invest.trade_type.lft',
  LTN: 'value.invest.trade_type.ltn',
  CDB: 'value.invest.trade_type.cdb',
  NTN: 'value.invest.trade_type.ntn',
  'AÇÃO': 'value.invest.trade_type.stock',
  FII: 'value.invest.trade_type.fii',
  BDR: 'value.invest.trade_type.bdr',
  'DEBÊNTURE': 'value.invest.trade_type.debenture',
  CRA: 'value.invest.trade_type.lft',
  CRI: 'value.invest.trade_type.lft',
  LCI: 'value.invest.trade_type.lft',
  LCA: 'value.invest.trade_type.lft',
};

const RF_FALLBACK = {
  cssClass: 'notes-type--rf',
  color: '#ec4899',
  cssVar: '--invest-type-rf',
};

const FALLBACK_BY_CODE = {
  CALL: { cssClass: 'notes-type--call', color: '#60a5fa', cssVar: '--invest-type-call' },
  PUT: { cssClass: 'notes-type--put', color: '#f97316', cssVar: '--invest-type-put' },
  EXEC: { cssClass: 'notes-type--exec', color: '#fbbf24', cssVar: '--invest-type-exec' },
  BTC: { cssClass: 'notes-type--btc', color: '#94a3b8', cssVar: '--invest-type-btc' },
  LFT: RF_FALLBACK,
  LTN: RF_FALLBACK,
  CDB: RF_FALLBACK,
  NTN: RF_FALLBACK,
  CRA: RF_FALLBACK,
  CRI: RF_FALLBACK,
  LCI: RF_FALLBACK,
  LCA: RF_FALLBACK,
  'DEBÊNTURE': RF_FALLBACK,
  'AÇÃO': { cssClass: 'notes-type--stock', color: '#f97316', cssVar: '--invest-type-stock' },
  FII: { cssClass: 'notes-type--fii', color: '#a78bfa', cssVar: '--invest-type-fii' },
  BDR: { cssClass: 'notes-type--bdr', color: '#38bdf8', cssVar: '--invest-type-bdr' },
};

export function tradeTypeTextKey(code) {
  return TRADE_TYPE_TEXT_KEY[code] ?? null;
}

/**
 * @param {object|null} manifest  resposta de /api/ui/manifest
 * @param {string} code         codigo canonico (CALL, PUT, ...)
 * @returns {{ label: string, cssClass: string|null, color: string|null }}
 */
export function resolveTradeTypeDisplay(manifest, code) {
  const key = tradeTypeTextKey(code);
  const fallback = FALLBACK_BY_CODE[code] || {};
  const entry = key && manifest?.entries?.[key];
  const meta = entry?.metadata || fallback;
  return {
    label: entry?.text ?? code,
    cssClass: meta.cssClass ? String(meta.cssClass) : null,
    color: meta.color ? String(meta.color) : null,
  };
}

/** Injeta CSS variables no :root a partir dos value.invest.trade_type.* do manifesto. */
export function applyTradeTypeTheme(manifest) {
  const root = document.documentElement;
  if (manifest?.entries) {
    const seen = new Set();
    for (const [key, entry] of Object.entries(manifest.entries)) {
      if (!key.startsWith('value.invest.trade_type.')) continue;
      const cssVar = entry.metadata?.cssVar;
      const color = entry.metadata?.color;
      if (!cssVar || !color || seen.has(cssVar)) continue;
      root.style.setProperty(String(cssVar), String(color));
      seen.add(cssVar);
    }
  }
  // Paleta canonica (opcoes + historico) — prevalece sobre manifesto desatualizado no banco.
  for (const fb of Object.values(FALLBACK_BY_CODE)) {
    if (fb.cssVar && fb.color) root.style.setProperty(fb.cssVar, fb.color);
  }
}

/**
 * @param {object} row
 * @param {object|null} manifest
 * @returns {HTMLSpanElement}
 */
export function renderTradeTypeCell(row, manifest) {
  const code = String(row.tradeType || '—');
  const span = document.createElement('span');
  if (code === '—') {
    span.textContent = '—';
    return span;
  }
  const { label, cssClass } = resolveTradeTypeDisplay(manifest, code);
  span.textContent = label;
  if (cssClass) span.className = cssClass;
  return span;
}
