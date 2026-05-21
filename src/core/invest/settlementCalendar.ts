/**
 * Calendário de liquidação na conta corrente investimento (BTG/B3).
 * Regras padrão; conferência final no extrato da corretora.
 */
import { inferAssetType } from './assetClassifier';

export const B3_STOCK_PAYMENT_BUSINESS_DAYS = 2;
export const B3_OPTION_PREMIUM_BUSINESS_DAYS = 1;

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

/** Soma N dias úteis (sáb/dom não contam). Feriados B3: fase 2. */
export function addBusinessDays(isoDate: string, businessDays: number): string {
  let remaining = Math.max(0, Math.floor(businessDays));
  const d = parseUtcDate(isoDate);
  if (!d) return isoDate.slice(0, 10) || isoDate;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    remaining -= 1;
  }
  return formatUtcDate(d);
}

export function isStockLikeAsset(assetType: string): boolean {
  return assetType === 'stock' || assetType === 'fii';
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
  if (t.startsWith('LFT-') || t.startsWith('TESOURO-') || t.startsWith('TD-')) return 1;
  if (t.startsWith('CDB-')) return 1;
  return 1;
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
  const type = String(transactionType);
  const tickerU = String(ticker || '').toUpperCase();

  if (isOptionPremiumTrade(assetType, type)) {
    return addBusinessDays(day, B3_OPTION_PREMIUM_BUSINESS_DAYS);
  }
  if (isStockLikeAsset(assetType) && (type === 'buy' || type === 'sell')) {
    return addBusinessDays(day, B3_STOCK_PAYMENT_BUSINESS_DAYS);
  }
  if (isFixedIncomeAsset(assetType, tickerU) && (type === 'buy' || type === 'sell')) {
    return addBusinessDays(day, fixedIncomeSettlementBusinessDays(tickerU));
  }
  return day;
}

export function defersCashSettlement(
  assetType: string,
  transactionType: string,
  ticker?: string
): boolean {
  const type = String(transactionType);
  const tickerU = String(ticker || '').toUpperCase();
  if (isOptionPremiumTrade(assetType, type)) return true;
  if (isStockLikeAsset(assetType) && (type === 'buy' || type === 'sell')) return true;
  if (isFixedIncomeAsset(assetType, tickerU) && (type === 'buy' || type === 'sell')) {
    return fixedIncomeSettlementBusinessDays(tickerU) > 0;
  }
  return false;
}

/** Rótulo da regra para UI / notas do livro. */
export function cashSettlementRuleLabel(
  assetType: string,
  transactionType: string,
  ticker?: string
): string {
  const type = String(transactionType);
  const tickerU = String(ticker || '').toUpperCase();
  if (isOptionPremiumTrade(assetType, type)) {
    return 'Opção — prêmio D+1 útil';
  }
  if (isStockLikeAsset(assetType) && (type === 'buy' || type === 'sell')) {
    return 'Ação/FII — liquidação D+2 úteis';
  }
  if (isFixedIncomeAsset(assetType, tickerU)) {
    const d = fixedIncomeSettlementBusinessDays(tickerU);
    return d === 0 ? 'Renda fixa — D0' : `Renda fixa — D+${d} útil(is)`;
  }
  return 'Liquidação no pregão';
}

/** Inferência de tipo quando o lançamento não traz asset_type explícito. */
export function resolveAssetTypeForSettlement(ticker: string, assetType?: string): string {
  const declared = String(assetType || '').trim();
  if (declared) return declared;
  return inferAssetType(ticker);
}
