import type {
  CanonicalMarketField,
  MarketDataConfidence,
} from './types';

/** Versao do catalogo de precedencia por subcategoria/campo (A-02). */
export const MARKET_DATA_PRECEDENCE_CATALOG_VERSION = 'A-02';

export type MarketDataPrecedenceRule = {
  assetSubcategory: string;
  field: CanonicalMarketField;
  /** Fontes em ordem de tentativa (source_code do registry). */
  sources: readonly string[];
  minConfidence?: MarketDataConfidence;
  /** Permite estimador auditavel quando fontes externas falham. */
  allowEstimate?: boolean;
  /** Dias maximos de defasagem aceitavel; null = sem limite catalogado. */
  maxStalenessDays?: number | null;
};

/**
 * Catalogo estatico A-02 — precedencia por subcategoria + campo canonico.
 * Migracao para tabela SQL fica fora desta entrega (decisao arquiteto).
 */
export const MARKET_DATA_PRECEDENCE_CATALOG: readonly MarketDataPrecedenceRule[] = [
  {
    assetSubcategory: 'stock',
    field: 'daily_close_price',
    sources: ['brapi', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: 5,
  },
  {
    assetSubcategory: 'etf',
    field: 'daily_close_price',
    sources: ['brapi', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: 5,
  },
  {
    assetSubcategory: 'fii',
    field: 'daily_close_price',
    sources: ['brapi', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: 5,
  },
  {
    assetSubcategory: 'equity_br',
    field: 'daily_close_price',
    sources: ['brapi', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: 5,
  },
  {
    assetSubcategory: 'option_call',
    field: 'daily_close_price',
    sources: ['opcoes_net', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: true,
    maxStalenessDays: 3,
  },
  {
    assetSubcategory: 'option_put',
    field: 'daily_close_price',
    sources: ['opcoes_net', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: true,
    maxStalenessDays: 3,
  },
  {
    assetSubcategory: 'option_br',
    field: 'daily_close_price',
    sources: ['opcoes_net', 'yahoo_finance', 'manual'],
    minConfidence: 'external',
    allowEstimate: true,
    maxStalenessDays: 3,
  },
  {
    assetSubcategory: 'option_call',
    field: 'contract_strike',
    sources: ['opcoes_net', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: null,
  },
  {
    assetSubcategory: 'option_put',
    field: 'contract_strike',
    sources: ['opcoes_net', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: null,
  },
  {
    assetSubcategory: 'option_call',
    field: 'contract_expiration',
    sources: ['opcoes_net', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: null,
  },
  {
    assetSubcategory: 'option_put',
    field: 'contract_expiration',
    sources: ['opcoes_net', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: null,
  },
  {
    assetSubcategory: 'option_call',
    field: 'contract_underlying',
    sources: ['opcoes_net', 'manual'],
    minConfidence: 'external',
    allowEstimate: false,
    maxStalenessDays: null,
  },
  {
    assetSubcategory: 'fixed_income',
    field: 'unit_price',
    sources: ['tesouro_direto', 'computed_cdi', 'manual'],
    minConfidence: 'official',
    allowEstimate: true,
    maxStalenessDays: 7,
  },
  {
    assetSubcategory: 'tesouro_selic',
    field: 'unit_price',
    sources: ['tesouro_direto', 'computed_cdi', 'manual'],
    minConfidence: 'official',
    allowEstimate: true,
    maxStalenessDays: 7,
  },
  {
    assetSubcategory: 'fx',
    field: 'fx_rate',
    sources: ['ptax', 'manual'],
    minConfidence: 'official',
    allowEstimate: false,
    maxStalenessDays: 2,
  },
  {
    assetSubcategory: '*',
    field: 'broker_anchor_patrimony',
    sources: ['broker_anchor', 'manual'],
    minConfidence: 'official',
    allowEstimate: false,
    maxStalenessDays: null,
  },
] as const;

export function findPrecedenceRule(
  assetSubcategory: string,
  field: CanonicalMarketField
): MarketDataPrecedenceRule | null {
  const sub = assetSubcategory.trim().toLowerCase();
  const exact = MARKET_DATA_PRECEDENCE_CATALOG.find(
    (r) => r.assetSubcategory === sub && r.field === field
  );
  if (exact) return exact;
  return (
    MARKET_DATA_PRECEDENCE_CATALOG.find(
      (r) => r.assetSubcategory === '*' && r.field === field
    ) ?? null
  );
}

export function resolvePrecedenceForField(
  assetSubcategory: string,
  field: CanonicalMarketField
): string[] {
  const rule = findPrecedenceRule(assetSubcategory, field);
  return rule ? [...rule.sources] : [];
}

export function resolvePrecedenceForFields(
  assetSubcategory: string,
  fields: CanonicalMarketField[]
): string[] {
  const ordered = new Set<string>();
  for (const field of fields) {
    for (const source of resolvePrecedenceForField(assetSubcategory, field)) {
      ordered.add(source);
    }
  }
  return [...ordered];
}

export function fetchOptionsForRule(
  rule: MarketDataPrecedenceRule | null
): { minConfidence?: MarketDataConfidence } {
  if (!rule?.minConfidence) return {};
  return { minConfidence: rule.minConfidence };
}
