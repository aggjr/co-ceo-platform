/**
 * Contratos canônicos de market data (A-01).
 * Fontes e precedência vivem em catálogo/registry — nunca em if (source === ...).
 */

/** Campos de mercado / cliente que o registry resolve por precedência configurada. */
export const CANONICAL_MARKET_FIELDS = [
  'daily_close_price',
  'daily_open_price',
  'daily_min_price',
  'daily_max_price',
  'volume',
  'contract_strike',
  'contract_expiration',
  'contract_option_type',
  'contract_underlying',
  'contract_metadata',
  'unit_price',
  'index_factor',
  'fx_rate',
  'client_quantity',
  'client_avg_price',
  'client_trade_value',
  'client_fee',
  'client_tax',
  'broker_anchor_patrimony',
  'broker_anchor_return',
] as const;

export type CanonicalMarketField = (typeof CANONICAL_MARKET_FIELDS)[number];

export type MarketDataScope = 'global' | 'tenant';

/** Escopo de cada campo — alinhado ao catálogo (seção 5.2 do plano). */
export const MARKET_FIELD_SCOPE: Readonly<Record<CanonicalMarketField, MarketDataScope>> = {
  daily_close_price: 'global',
  daily_open_price: 'global',
  daily_min_price: 'global',
  daily_max_price: 'global',
  volume: 'global',
  contract_strike: 'global',
  contract_expiration: 'global',
  contract_option_type: 'global',
  contract_underlying: 'global',
  contract_metadata: 'global',
  unit_price: 'global',
  index_factor: 'global',
  fx_rate: 'global',
  client_quantity: 'tenant',
  client_avg_price: 'tenant',
  client_trade_value: 'tenant',
  client_fee: 'tenant',
  client_tax: 'tenant',
  broker_anchor_patrimony: 'tenant',
  broker_anchor_return: 'tenant',
};

/**
 * Confiança do valor retornado — ordem crescente de preferência em empate de fonte.
 * `exact`: observado no dia, mesma bolsa/sessão.
 * `official`: fonte regulada ou arquivo oficial (ex. CSV Tesouro Transparente).
 * `external`: agregador de mercado (brapi, opções.net, Yahoo).
 * `estimated`: modelo ou interpolador auditável (Black-Scholes, VNA LFT).
 * `manual`: entrada humana explícita.
 */
export type MarketDataConfidence =
  | 'exact'
  | 'official'
  | 'external'
  | 'estimated'
  | 'manual';

export const MARKET_DATA_CONFIDENCE_RANK: Readonly<Record<MarketDataConfidence, number>> = {
  exact: 5,
  official: 4,
  external: 3,
  estimated: 2,
  manual: 1,
};

export type CanonicalAssetRef = {
  ticker: string;
  /** Subcategoria de module_categories (ex. equity_br, option_br, tesouro_selic). */
  assetSubcategory: string;
  currencyCode?: string;
  exchangeCode?: string | null;
};

export type TenantRef = {
  organizationId: string;
};

export type MarketDataRequest = {
  asOfDate: string;
  asset: CanonicalAssetRef;
  fields: CanonicalMarketField[];
  tenant?: TenantRef;
};

export type MarketDataFieldValue = number | string | null;

export type MarketDataResult = {
  asset: CanonicalAssetRef;
  field: CanonicalMarketField;
  value: MarketDataFieldValue;
  asOfDate: string;
  sourceCode: string;
  confidence: MarketDataConfidence;
  metadata?: Record<string, unknown>;
};

export type MarketDataProviderCapability = {
  assetSubcategories: string[];
  fields: CanonicalMarketField[];
  historical: boolean;
  realtime: boolean;
  /** Menor número = maior prioridade default quando catálogo não especifica. */
  priority: number;
};

export type MarketDataProviderRateLimit = {
  requestsPerMinute?: number;
  batchSize?: number;
};

/** Adaptador de uma fonte externa — implementações concretas ficam em M-02+. */
export interface MarketDataProvider {
  readonly sourceCode: string;
  readonly capabilities: MarketDataProviderCapability[];
  canHandle(request: MarketDataRequest): Promise<boolean>;
  fetch(request: MarketDataRequest): Promise<MarketDataResult[]>;
}

export type MarketDataErrorCode =
  | 'provider_disabled'
  | 'provider_not_registered'
  | 'provider_cannot_handle'
  | 'fetch_failed'
  | 'rate_limited'
  | 'invalid_request'
  | 'no_data';

export type MarketDataSourceFailure = {
  sourceCode: string;
  field: CanonicalMarketField;
  errorCode: MarketDataErrorCode;
  message: string;
  retryable: boolean;
};

export type MarketDataFetchOptions = {
  /** Para campos tenant, organizationId obrigatório. */
  requireTenantForTenantFields?: boolean;
  /** Confiança mínima aceita; abaixo disso tenta próxima fonte. */
  minConfidence?: MarketDataConfidence;
  /** Quando true, falha de uma fonte não interrompe as demais (default). */
  continueOnSourceFailure?: boolean;
};

export type MarketDataFetchReport = {
  request: MarketDataRequest;
  precedence: string[];
  results: MarketDataResult[];
  resolvedByField: Partial<Record<CanonicalMarketField, MarketDataResult>>;
  missingFields: CanonicalMarketField[];
  failures: MarketDataSourceFailure[];
};

export function isCanonicalMarketField(value: string): value is CanonicalMarketField {
  return (CANONICAL_MARKET_FIELDS as readonly string[]).includes(value);
}

export function marketFieldScope(field: CanonicalMarketField): MarketDataScope {
  return MARKET_FIELD_SCOPE[field];
}

export function isGlobalMarketField(field: CanonicalMarketField): boolean {
  return MARKET_FIELD_SCOPE[field] === 'global';
}

export function isTenantMarketField(field: CanonicalMarketField): boolean {
  return MARKET_FIELD_SCOPE[field] === 'tenant';
}

export function compareMarketDataConfidence(
  a: MarketDataConfidence,
  b: MarketDataConfidence
): number {
  return MARKET_DATA_CONFIDENCE_RANK[a] - MARKET_DATA_CONFIDENCE_RANK[b];
}

export function providerSupportsField(
  provider: MarketDataProvider,
  assetSubcategory: string,
  field: CanonicalMarketField
): boolean {
  return provider.capabilities.some(
    (cap) =>
      cap.fields.includes(field) &&
      cap.assetSubcategories.some(
        (sub) => sub === assetSubcategory || sub === '*'
      )
  );
}

/**
 * Regras de erro/fallback (A-01) — o registry aplica na orquestração:
 *
 * 1. Para cada campo solicitado, percorrer `precedence` na ordem do catálogo.
 * 2. Ignorar fonte desabilitada (`provider_disabled`).
 * 3. Ignorar fonte não registrada (`provider_not_registered`) — registra falha e continua.
 * 4. Se `canHandle` false, pular (`provider_cannot_handle`).
 * 5. Erro de rede/parse/rate limit: registrar em `failures` e tentar próxima fonte.
 * 6. Valor ausente ou null: tratar como `no_data` e tentar próxima fonte.
 * 7. Quando duas fontes retornam o mesmo campo, vence a de maior `MARKET_DATA_CONFIDENCE_RANK`
 *    entre as já obtidas na mesma execução (desempate: ordem de precedência).
 * 8. Campos `tenant` exigem `request.tenant.organizationId` — senão `invalid_request`.
 * 9. Estimadores (ex. Black-Scholes) são providers/estimators separados com confidence `estimated`.
 * 10. Falha parcial nunca aborta refresh de outros ativos/campos no mesmo lote.
 */
export const MARKET_DATA_FALLBACK_RULES_VERSION = 'A-01';
