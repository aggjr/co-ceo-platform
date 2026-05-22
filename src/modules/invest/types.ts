/**
 * Tipos especificos do modulo INVEST. Refletem `invest_position_ext` e
 * `invest_option_ext`, alem dos inputs publicos das operacoes.
 */

export type InvestAssetClass =
  | 'stock'
  | 'fii'
  | 'option_call'
  | 'option_put'
  | 'fixed_income'
  | 'etf'
  | 'bdr';

export type InvestPositionExtRow = {
  patrimony_item_id: string;
  organization_id: string;
  asset_class: InvestAssetClass;
  underlying_ticker: string | null;
  pm_estrito: number | null;
  pm_b3: number | null;
  pm_gerencial: number | null;
  last_price: number | null;
  last_price_as_of: string | null;
  sector: string | null;
  issuer_name: string | null;
  metadata: Record<string, unknown> | null;
};

export type InvestOptionExtRow = {
  patrimony_item_id: string;
  organization_id: string;
  option_type: 'CALL' | 'PUT';
  underlying_ticker: string;
  strike_price: number;
  expiration_date: string;
  european_american: 'E' | 'A';
};

export type OpeningPositionInput = {
  ticker: string;
  assetClass: InvestAssetClass;
  /** quantidade (negativa para shorts: opcoes vendidas). */
  quantity: number;
  /** preco unitario absoluto (sempre positivo). */
  unitPrice: number;
  /** apenas para opcoes */
  optionUnderlying?: string;
  optionStrike?: number;
  optionExpiration?: string;
  optionType?: 'CALL' | 'PUT';
  name?: string;
  notes?: string;
};

export type OpeningCashInput = {
  /** ex: "BTG", "XP", "ITAU" */
  brokerCode: string;
  accountName?: string;
  externalId?: string;
  balance: number;
  /** se true permite saldo negativo (overdraft) */
  allowOverdraft?: boolean;
};

export type OpeningBatchInput = {
  asOfDate: string;
  positions: OpeningPositionInput[];
  cashAccounts: OpeningCashInput[];
};

export type OpeningBatchResult = {
  patrimonyItemsCreated: number;
  ledgerEntriesCreated: number;
  cashAccountsCreated: number;
  cashEntriesCreated: number;
  longsValue: number;
  shortsValue: number;
  cashTotal: number;
  totalPatrimony: number;
};
