/**
 * Calendário de liquidação na conta corrente investimento (BTG/B3).
 * Regras padrão; conferência final no extrato da corretora.
 */
import { inferAssetType } from './assetClassifier';

export const B3_STOCK_PAYMENT_BUSINESS_DAYS = 2;
export const B3_OPTION_PREMIUM_BUSINESS_DAYS = 1;

export type SettlementCalendarUnit = 'business_days' | 'calendar_days';

export type SettlementCounterparty = {
  counterpartyCode: string;
  moduleCode: string;
  counterpartyKind: 'exchange' | 'broker' | 'supplier' | 'customer' | 'internal' | 'other';
  countryCode?: string;
  canonicalName: string;
};

export type SettlementContractType = {
  contractTypeCode: string;
  moduleCode: string;
  canonicalName: string;
  description?: string;
};

export type SettlementCounterpartyContractType = {
  counterpartyCode: string;
  contractTypeCode: string;
  isDefault?: boolean;
};

export type InvestmentSettlementRule = {
  ruleCode: string;
  contractTypeCode: string;
  assetTypes: string[];
  transactionTypes: string[];
  tickerPrefixes?: string[];
  validFrom: string;
  validTo?: string | null;
  daysOffset: number;
  calendarUnit: SettlementCalendarUnit;
  label: string;
};

export const SETTLEMENT_COUNTERPARTIES: SettlementCounterparty[] = [
  {
    counterpartyCode: 'B3_BR',
    moduleCode: 'INVEST',
    counterpartyKind: 'exchange',
    countryCode: 'BR',
    canonicalName: 'B3 Brasil Bolsa Balcao',
  },
  {
    counterpartyCode: 'TESOURO_BR',
    moduleCode: 'INVEST',
    counterpartyKind: 'supplier',
    countryCode: 'BR',
    canonicalName: 'Tesouro Direto',
  },
  {
    counterpartyCode: 'BTG_BR',
    moduleCode: 'INVEST',
    counterpartyKind: 'broker',
    countryCode: 'BR',
    canonicalName: 'BTG Pactual',
  },
];

export const SETTLEMENT_CONTRACT_TYPES: SettlementContractType[] = [
  {
    contractTypeCode: 'B3_OPTION_PREMIUM',
    moduleCode: 'INVEST',
    canonicalName: 'Premio de opcao B3',
    description: 'Premios de compra/venda de opcoes padronizadas B3.',
  },
  {
    contractTypeCode: 'B3_EQUITY_SPOT',
    moduleCode: 'INVEST',
    canonicalName: 'Mercado a vista B3',
    description: 'Acoes, FIIs, ETFs e BDRs negociados a vista.',
  },
  {
    contractTypeCode: 'BR_FIXED_INCOME_SPOT',
    moduleCode: 'INVEST',
    canonicalName: 'Renda fixa Brasil',
    description: 'Titulos de renda fixa, Tesouro e CDBs.',
  },
  {
    contractTypeCode: 'SECURITIES_LENDING',
    moduleCode: 'INVEST',
    canonicalName: 'Aluguel/termo de ativos',
    description: 'Contratos padronizados de aluguel/remuneracao/termo.',
  },
];

export const SETTLEMENT_COUNTERPARTY_CONTRACT_TYPES: SettlementCounterpartyContractType[] = [
  { counterpartyCode: 'B3_BR', contractTypeCode: 'B3_OPTION_PREMIUM', isDefault: true },
  { counterpartyCode: 'B3_BR', contractTypeCode: 'B3_EQUITY_SPOT', isDefault: true },
  { counterpartyCode: 'B3_BR', contractTypeCode: 'SECURITIES_LENDING', isDefault: true },
  { counterpartyCode: 'TESOURO_BR', contractTypeCode: 'BR_FIXED_INCOME_SPOT', isDefault: true },
  { counterpartyCode: 'BTG_BR', contractTypeCode: 'BR_FIXED_INCOME_SPOT' },
];

export const INVESTMENT_SETTLEMENT_RULES: InvestmentSettlementRule[] = [
  {
    ruleCode: 'B3_OPTION_PREMIUM_D1',
    contractTypeCode: 'B3_OPTION_PREMIUM',
    assetTypes: ['option_call', 'option_put'],
    transactionTypes: ['call_sell', 'put_sell', 'call_buy', 'put_buy'],
    validFrom: '1900-01-01',
    daysOffset: 1,
    calendarUnit: 'business_days',
    label: 'Opção — prêmio D+1 útil',
  },
  {
    ruleCode: 'B3_EQUITY_D3_LEGACY',
    contractTypeCode: 'B3_EQUITY_SPOT',
    assetTypes: ['stock', 'fii', 'etf', 'bdr'],
    transactionTypes: ['buy', 'sell'],
    validFrom: '1900-01-01',
    validTo: '2019-05-26',
    daysOffset: 3,
    calendarUnit: 'business_days',
    label: 'Ação/FII — liquidação D+3 úteis (regra histórica)',
  },
  {
    ruleCode: 'B3_EQUITY_D2',
    contractTypeCode: 'B3_EQUITY_SPOT',
    assetTypes: ['stock', 'fii', 'etf', 'bdr'],
    transactionTypes: ['buy', 'sell'],
    validFrom: '2019-05-27',
    daysOffset: 2,
    calendarUnit: 'business_days',
    label: 'Ação/FII — liquidação D+2 úteis',
  },
  {
    ruleCode: 'TESOURO_D1',
    contractTypeCode: 'BR_FIXED_INCOME_SPOT',
    assetTypes: ['fixed_income'],
    transactionTypes: ['buy', 'sell'],
    tickerPrefixes: ['TESOURO-', 'TD-', 'LFT-'],
    validFrom: '1900-01-01',
    daysOffset: 1,
    calendarUnit: 'business_days',
    label: 'Tesouro/RF — D+1 útil',
  },
  {
    ruleCode: 'CDB_D1',
    contractTypeCode: 'BR_FIXED_INCOME_SPOT',
    assetTypes: ['fixed_income'],
    transactionTypes: ['buy', 'sell'],
    tickerPrefixes: ['CDB-'],
    validFrom: '1900-01-01',
    daysOffset: 1,
    calendarUnit: 'business_days',
    label: 'CDB — D+1 útil',
  },
  {
    ruleCode: 'FIXED_INCOME_D1',
    contractTypeCode: 'BR_FIXED_INCOME_SPOT',
    assetTypes: ['fixed_income'],
    transactionTypes: ['buy', 'sell'],
    validFrom: '1900-01-01',
    daysOffset: 1,
    calendarUnit: 'business_days',
    label: 'Renda fixa — D+1 útil',
  },
  {
    ruleCode: 'SECURITIES_LENDING_NET30',
    contractTypeCode: 'SECURITIES_LENDING',
    assetTypes: ['stock', 'fii', 'securities_lending'],
    transactionTypes: ['securities_lending'],
    validFrom: '1900-01-01',
    daysOffset: 30,
    calendarUnit: 'calendar_days',
    label: 'Aluguel/termo — liquidação D+30 corridos',
  },
];

const MS_DAY = 24 * 60 * 60 * 1000;

function parseUtcDate(isoDate: string): Date | null {
  const day = isoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function easterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function b3HolidaySet(year: number): Set<string> {
  const fixed = [
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-12-25`,
  ];
  const easter = easterSundayUtc(year);
  return new Set([
    ...fixed,
    formatUtcDate(addUtcDays(easter, -48)), // Carnaval segunda
    formatUtcDate(addUtcDays(easter, -47)), // Carnaval terca
    formatUtcDate(addUtcDays(easter, -2)),  // Paixao de Cristo
    formatUtcDate(addUtcDays(easter, 60)),  // Corpus Christi
  ]);
}

export function isB3BusinessHoliday(isoDate: string): boolean {
  const d = parseUtcDate(isoDate);
  if (!d) return false;
  const year = d.getUTCFullYear();
  return b3HolidaySet(year).has(formatUtcDate(d));
}

/** Soma N dias úteis B3 (sáb/dom e feriados nacionais/B3 não contam). */
export function addBusinessDays(isoDate: string, businessDays: number): string {
  let remaining = Math.max(0, Math.floor(businessDays));
  const d = parseUtcDate(isoDate);
  if (!d) return isoDate.slice(0, 10) || isoDate;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (isB3BusinessHoliday(formatUtcDate(d))) continue;
    remaining -= 1;
  }
  return formatUtcDate(d);
}

export function addCalendarDays(isoDate: string, calendarDays: number): string {
  const d = parseUtcDate(isoDate);
  if (!d) return isoDate.slice(0, 10) || isoDate;
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.floor(calendarDays)));
  return formatUtcDate(d);
}

export function isStockLikeAsset(assetType: string): boolean {
  return assetType === 'stock' || assetType === 'fii' || assetType === 'etf' || assetType === 'bdr';
}

export function isFixedIncomeAsset(assetType: string, ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return (
    assetType === 'fixed_income' ||
    t.startsWith('TESOURO-') ||
    t.startsWith('CDB-') ||
    t.startsWith('LFT-') ||
    t.startsWith('TD-')
  );
}

export function isOptionAsset(assetType: string): boolean {
  return assetType === 'option_call' || assetType === 'option_put';
}

/** Prêmio de opção (compra ou venda): liquidação na conta em D+1 útil (BTG). */
export function isOptionPremiumTrade(assetType: string, transactionType: string): boolean {
  const type = String(transactionType);
  if (type !== 'call_sell' && type !== 'put_sell' && type !== 'call_buy' && type !== 'put_buy') {
    return false;
  }
  return isOptionAsset(assetType);
}

/**
 * Dias úteis até liquidação na conta para renda fixa.
 * Valor canônico vem do extrato/nota quando importado; até lá, heurística por prefixo do ticker.
 */
export function fixedIncomeSettlementBusinessDays(ticker: string): number {
  const t = ticker.trim().toUpperCase();
  const rule = investmentSettlementRuleFor(new Date().toISOString().slice(0, 10), 'fixed_income', 'buy', t);
  return rule?.calendarUnit === 'business_days' ? rule.daysOffset : 1;
}

function tickerMatches(rule: InvestmentSettlementRule, ticker: string): boolean {
  if (!rule.tickerPrefixes?.length) return true;
  const t = ticker.toUpperCase();
  return rule.tickerPrefixes.some((prefix) => t.startsWith(prefix));
}

function dateMatches(rule: InvestmentSettlementRule, tradeDate: string): boolean {
  const day = tradeDate.slice(0, 10);
  return day >= rule.validFrom && (!rule.validTo || day <= rule.validTo);
}

export function investmentSettlementRuleFor(
  tradeDate: string,
  assetType: string,
  transactionType: string,
  ticker?: string
): InvestmentSettlementRule | null {
  const day = tradeDate.slice(0, 10);
  const type = String(transactionType);
  const asset = String(assetType || '').trim();
  const tickerU = String(ticker || '').toUpperCase();
  return (
    INVESTMENT_SETTLEMENT_RULES.find(
      (rule) =>
        dateMatches(rule, day) &&
        rule.assetTypes.includes(asset) &&
        rule.transactionTypes.includes(type) &&
        tickerMatches(rule, tickerU)
    ) ?? null
  );
}

function applySettlementOffset(day: string, rule: InvestmentSettlementRule): string {
  return rule.calendarUnit === 'calendar_days'
    ? addCalendarDays(day, rule.daysOffset)
    : addBusinessDays(day, rule.daysOffset);
}

/**
 * Data em que o pagamento/recebimento cai na conta corrente investimento.
 */
export function cashSettlementDate(
  tradeDate: string,
  assetType: string,
  transactionType: string,
  ticker?: string
): string {
  const day = tradeDate.slice(0, 10);
  const rule = investmentSettlementRuleFor(day, assetType, transactionType, ticker);
  return rule ? applySettlementOffset(day, rule) : day;
}

export function defersCashSettlement(
  assetType: string,
  transactionType: string,
  ticker?: string
): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const rule = investmentSettlementRuleFor(day, assetType, transactionType, ticker);
  return Boolean(rule && rule.daysOffset > 0);
}

/** Rótulo da regra para UI / notas do livro. */
export function cashSettlementRuleLabel(
  assetType: string,
  transactionType: string,
  ticker?: string,
  tradeDate?: string
): string {
  const day = (tradeDate || new Date().toISOString()).slice(0, 10);
  const rule = investmentSettlementRuleFor(day, assetType, transactionType, ticker);
  return rule?.label ?? 'Liquidação no pregão';
}

/** Inferência de tipo quando o lançamento não traz asset_type explícito. */
export function resolveAssetTypeForSettlement(ticker: string, assetType?: string): string {
  const declared = String(assetType || '').trim();
  if (declared) return declared;
  return inferAssetType(ticker);
}
