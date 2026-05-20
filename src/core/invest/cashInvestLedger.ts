import type { LedgerEvent } from './CustodyEngine';

const CASH_TICKER_PREFIX = 'CAIXA';

/** Saldo em conta investimento = soma dos total_net_value dos lançamentos de caixa até a data. */
export function cashBalanceFromLedger(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  const asOf = (asOfDate || new Date().toISOString()).slice(0, 10);
  let sum = 0;
  for (const e of entries || []) {
    const t = String(e.asset_ticker || '').toUpperCase();
    if (!t.startsWith(CASH_TICKER_PREFIX)) continue;
    const d = String(e.transaction_date || '').slice(0, 10);
    if (d && d > asOf) continue;
    sum += Number(e.total_net_value ?? 0);
  }
  return Math.round(sum * 100) / 100;
}

export function isCashInvestTicker(ticker: string): boolean {
  return String(ticker || '').toUpperCase().startsWith(CASH_TICKER_PREFIX);
}

/** Saldo para exibição = livro razão (única fonte). */
export function resolveCashInvestDisplayBalance(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  return cashBalanceFromLedger(entries, asOfDate);
}
