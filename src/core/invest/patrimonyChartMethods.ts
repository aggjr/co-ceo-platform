/** Fechamento diario gravado — patrimonio economico (fonte canonica). */
export const PATRIMONY_SOURCE_ECONOMIC = 'mtm_economic' as const;

/** Legado: registros antigos em invest_portfolio_daily (leitura retrocompativel). */
export const PATRIMONY_SOURCE_STORED_LEGACY = 'mtm_btg_calibrated' as const;

/** Query API — curva interpolada BTG (overlay de referencia, nao economico). */
export const PATRIMONY_CHART_METHOD_BTG = 'mtm_btg' as const;

export const PATRIMONY_CHART_METHOD_ECONOMIC = 'mtm_economic' as const;

/** meta.method da serie interpolada BTG (grafico). */
export const PATRIMONY_META_BTG_INTERPOLATED = 'mtm_btg_interpolated' as const;

const LEGACY_COMPARE_QUERY_METHODS = new Set([
  'mtm_btg_calibrated',
  'mtm_economic_calibrated',
  'mtm_economic_compare',
]);

export function isLegacyStoredPatrimonySource(source: string): boolean {
  return source === PATRIMONY_SOURCE_STORED_LEGACY;
}

/** Normaliza method da query e flag compareAnchor (sem plug — so meta/divergencia). */
export function resolvePatrimonyChartQuery(
  rawMethod: string,
  compareAnchorParam?: string | boolean | null
): { method: string; compareAnchor: boolean } {
  const m = rawMethod.toLowerCase();
  const compareFromQuery =
    compareAnchorParam === true ||
    compareAnchorParam === '1' ||
    compareAnchorParam === 'true';
  if (LEGACY_COMPARE_QUERY_METHODS.has(m)) {
    return { method: PATRIMONY_CHART_METHOD_ECONOMIC, compareAnchor: true };
  }
  return { method: m, compareAnchor: compareFromQuery };
}

export function storedSourceMatchesChartMethod(source: string, method: string): boolean {
  const m = method.toLowerCase();
  if (m === PATRIMONY_CHART_METHOD_BTG || m === 'mtm_recorded') {
    return isLegacyStoredPatrimonySource(source);
  }
  if (m === PATRIMONY_CHART_METHOD_ECONOMIC || m === 'mtm_economic_compare') {
    return source === PATRIMONY_SOURCE_ECONOMIC || isLegacyStoredPatrimonySource(source);
  }
  return false;
}
