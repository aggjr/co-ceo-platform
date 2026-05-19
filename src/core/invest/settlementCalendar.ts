/**
 * Compra de ação/FII: negócio no pregão (D0), pagamento na conta em D+2 úteis.
 * Venda: crédito na conta também em D+2 úteis (liquidação B3).
 */
export const B3_STOCK_PAYMENT_BUSINESS_DAYS = 2;

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

/** Prêmio de opção vendida: liquidação na conta em D+1 útil (BTG). */
export function isOptionPremiumSell(assetType: string, transactionType: string): boolean {
  const type = String(transactionType);
  if (type !== 'call_sell' && type !== 'put_sell') return false;
  return assetType === 'option_call' || assetType === 'option_put';
}

/**
 * Data em que o pagamento/recebimento cai na conta corrente investimento.
 * Compra ou venda de ação/FII: D+2 úteis após o pregão.
 */
export function cashSettlementDate(
  tradeDate: string,
  assetType: string,
  transactionType: string
): string {
  const day = tradeDate.slice(0, 10);
  const type = String(transactionType);
  if (isOptionPremiumSell(assetType, type)) {
    return addBusinessDays(day, 1);
  }
  if (isStockLikeAsset(assetType) && (type === 'buy' || type === 'sell')) {
    return addBusinessDays(day, B3_STOCK_PAYMENT_BUSINESS_DAYS);
  }
  return day;
}

export function defersCashSettlement(assetType: string, transactionType: string): boolean {
  const type = String(transactionType);
  return (
    isStockLikeAsset(assetType) &&
    (type === 'buy' || type === 'sell') &&
    cashSettlementDate('2000-01-01', assetType, type) !== '2000-01-01'
  );
}
