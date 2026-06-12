import type { CoCeoDataGateway, UserContext } from '../../dal';
import { ModuleCategories } from '../../module-registry';
import type { ModuleCategoryRow } from '../../module-registry';

export type AssetValuationCategory = {
  moduleCode: string;
  category: string;
  subcategory: string;
  contributesToPatrimony: boolean;
  requiresMarketQuote: boolean;
  quoteSource: string | null;
  valuationMode: string;
  exchangeCode: string | null;
  currencyCode: string;
  settlementCounterpartyCode: string | null;
  settlementContractTypeCode: string | null;
  affectsPortfolio: boolean;
  affectsFinancial: boolean;
};

export type AssetValuationSnapshot = {
  categories: Map<string, AssetValuationCategory>;
  contributesToPatrimony: Set<string>;
  requiresMarketQuote: Set<string>;
  quoteSourceByType: Map<string, string>;
  valuationModeByType: Map<string, string>;
  currencyByType: Map<string, string>;
  exchangeByType: Map<string, string>;
  affectsPortfolio: Set<string>;
  affectsFinancial: Set<string>;
};

function truthy(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === true || value === 1 || value === '1';
}

function normalizeRow(row: ModuleCategoryRow): AssetValuationCategory {
  return {
    moduleCode: row.module_code,
    category: row.category,
    subcategory: row.subcategory.toLowerCase(),
    contributesToPatrimony: truthy(row.contributes_to_patrimony, false),
    requiresMarketQuote: truthy(row.requires_market_quote, false),
    quoteSource: row.default_quote_source ? String(row.default_quote_source) : null,
    valuationMode: String(row.valuation_mode ?? 'historical_cost'),
    exchangeCode: row.exchange_code ? String(row.exchange_code) : null,
    currencyCode: String(row.currency_code ?? 'BRL').toUpperCase(),
    settlementCounterpartyCode: row.default_settlement_counterparty_code
      ? String(row.default_settlement_counterparty_code)
      : null,
    settlementContractTypeCode: row.default_settlement_contract_type_code
      ? String(row.default_settlement_contract_type_code)
      : null,
    affectsPortfolio: truthy(row.affects_portfolio, true),
    affectsFinancial: truthy(row.affects_financial, true),
  };
}

export function emptyAssetValuationSnapshot(): AssetValuationSnapshot {
  return {
    categories: new Map(),
    contributesToPatrimony: new Set(),
    requiresMarketQuote: new Set(),
    quoteSourceByType: new Map(),
    valuationModeByType: new Map(),
    currencyByType: new Map(),
    exchangeByType: new Map(),
    affectsPortfolio: new Set(),
    affectsFinancial: new Set(),
  };
}

export class AssetValuationContext {
  private readonly categories: ModuleCategories;
  private snapshot: AssetValuationSnapshot | null = null;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.categories = new ModuleCategories(gateway);
  }

  async load(ctx: UserContext, moduleCode = 'INVEST'): Promise<AssetValuationSnapshot> {
    if (this.snapshot) return this.snapshot;
    this.categories.clearCache();
    const rows = await this.categories.listForModule(ctx, moduleCode);
    const snapshot = emptyAssetValuationSnapshot();
    for (const row of rows) {
      const category = normalizeRow(row);
      const key = category.subcategory;
      snapshot.categories.set(key, category);
      if (category.contributesToPatrimony) snapshot.contributesToPatrimony.add(key);
      if (category.requiresMarketQuote) snapshot.requiresMarketQuote.add(key);
      if (category.quoteSource) snapshot.quoteSourceByType.set(key, category.quoteSource);
      snapshot.valuationModeByType.set(key, category.valuationMode);
      snapshot.currencyByType.set(key, category.currencyCode);
      if (category.exchangeCode) snapshot.exchangeByType.set(key, category.exchangeCode);
      if (category.affectsPortfolio) snapshot.affectsPortfolio.add(key);
      if (category.affectsFinancial) snapshot.affectsFinancial.add(key);
    }
    this.snapshot = snapshot;
    return snapshot;
  }

  clear(): void {
    this.snapshot = null;
    this.categories.clearCache();
  }
}

export function categoryFor(
  snapshot: AssetValuationSnapshot | undefined,
  assetType: string
): AssetValuationCategory | null {
  return snapshot?.categories.get(assetType.toLowerCase()) ?? null;
}

export function isCashCategory(assetType: string, ticker = ''): boolean {
  const type = assetType.toLowerCase();
  return type === 'cash' || ticker.toUpperCase().startsWith('CAIXA-');
}

export function isOptionCategory(
  snapshot: AssetValuationSnapshot | undefined,
  assetType: string
): boolean {
  const type = assetType.toLowerCase();
  const category = categoryFor(snapshot, type);
  return category?.settlementContractTypeCode === 'B3_OPTION_PREMIUM'
    || type === 'option_call'
    || type === 'option_put';
}

export function isFixedIncomeCategory(
  snapshot: AssetValuationSnapshot | undefined,
  assetType: string
): boolean {
  const type = assetType.toLowerCase();
  const category = categoryFor(snapshot, type);
  return category?.settlementContractTypeCode === 'BR_FIXED_INCOME_SPOT'
    || type === 'fixed_income';
}

function isDefaultMarketPricedAssetType(assetType: string): boolean {
  return ['stock', 'fii', 'etf', 'bdr'].includes(assetType.toLowerCase());
}

export function contributesToMarketPricedPatrimony(
  snapshot: AssetValuationSnapshot | undefined,
  assetType: string,
  ticker = ''
): boolean {
  const type = assetType.toLowerCase();
  if (isCashCategory(type, ticker)) return false;
  if (isDefaultMarketPricedAssetType(type)) return true;
  const category = categoryFor(snapshot, type);
  if (!category) {
    return !isOptionCategory(snapshot, type) && !isFixedIncomeCategory(snapshot, type);
  }
  return category.contributesToPatrimony && category.valuationMode === 'market_price';
}

export function currencyFor(
  snapshot: AssetValuationSnapshot | undefined,
  assetType: string
): string {
  return categoryFor(snapshot, assetType)?.currencyCode ?? 'BRL';
}
