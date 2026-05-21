import type { LedgerEvent } from './CustodyEngine';
import { AUTO_D2_REF_PREFIX } from './AutoPendingSettlementSync';

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

function sumOpenPendingOnCash(
  entries: LedgerEvent[] | null | undefined,
  asOfDate: string
): number {
  const byRef = new Map<string, number>();
  for (const e of entries || []) {
    const t = String(e.asset_ticker || '').toUpperCase();
    if (!t.startsWith(CASH_TICKER_PREFIX)) continue;
    if (String(e.transaction_type) !== 'pending_settlement') continue;
    const d = String(e.transaction_date || '').slice(0, 10);
    if (d && d > asOfDate) continue;
    const ref = String(e.broker_note_ref || '');
    if (!ref.startsWith(AUTO_D2_REF_PREFIX)) continue;
    if (ref.endsWith(':CLEAR')) {
      byRef.set(ref.slice(0, -':CLEAR'.length), 0);
    } else {
      byRef.set(ref, (byRef.get(ref) ?? 0) + Number(e.total_net_value ?? 0));
    }
  }
  let sum = 0;
  for (const v of byRef.values()) {
    if (Math.abs(v) >= 0.005) sum += v;
  }
  return Math.round(sum * 100) / 100;
}

/** Saldo em conta corrente liquidado (extrato; sem previsões em trânsito abertas). */
export function settledCashBalanceFromLedger(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  const asOf = (asOfDate || new Date().toISOString()).slice(0, 10);
  const open = sumOpenPendingOnCash(entries, asOf);
  return Math.round((cashBalanceFromLedger(entries, asOf) - open) * 100) / 100;
}

/** Saldo para exibição = conta corrente liquidada. */
export function resolveCashInvestDisplayBalance(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  return settledCashBalanceFromLedger(entries, asOfDate);
}
