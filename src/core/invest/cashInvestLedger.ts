import type { LedgerEvent } from './CustodyEngine';
import { AUTO_D2_REF_PREFIX } from './AutoPendingSettlementSync';
import { isDuplicateManualOpeningCash } from './extractLedgerEnrichment';

const CASH_TICKER_PREFIX = 'CAIXA';

function isAutoPending(e: LedgerEvent): boolean {
  const ref = String(e.broker_note_ref || '');
  return (
    String(e.transaction_type) === 'pending_settlement' &&
    ref.startsWith(AUTO_D2_REF_PREFIX)
  );
}

/** Mesma regra do extrato BTG na UI: ignora abertura manual duplicada quando já há BTG-EXTRATO-OPENING. */
export function cashLedgerEventsForBalance(
  entries: LedgerEvent[] | null | undefined,
  options?: { includeAutoPending?: boolean }
): LedgerEvent[] {
  const cashOnly = (entries || []).filter((e) =>
    isCashInvestTicker(String(e.asset_ticker || ''))
  );
  return cashOnly.filter(
    (e) =>
      !isDuplicateManualOpeningCash(e, cashOnly) &&
      (options?.includeAutoPending || !isAutoPending(e))
  );
}

/** Saldo em conta investimento = soma dos total_net_value dos lançamentos de caixa até a data. */
export function cashBalanceFromLedger(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  const asOf = (asOfDate || new Date().toISOString()).slice(0, 10);
  let sum = 0;
  for (const e of cashLedgerEventsForBalance(entries)) {
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

  for (const e of cashLedgerEventsForBalance(entries, { includeAutoPending: true })) {
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

/**
 * Soma das pernas de pending auto (D+2) que já liquidaram: a perna aberta entra
 * no saldo liquidado somente quando existe a perna `:CLEAR` com data <= asOf.
 */
function sumClearedPendingOnCash(
  entries: LedgerEvent[] | null | undefined,
  asOfDate: string
): number {
  const openByRef = new Map<string, number>();
  const clearDateByRef = new Map<string, string>();

  for (const e of cashLedgerEventsForBalance(entries, { includeAutoPending: true })) {
    if (String(e.transaction_type) !== 'pending_settlement') continue;
    const ref = String(e.broker_note_ref || '');
    if (!ref.startsWith(AUTO_D2_REF_PREFIX)) continue;
    const d = String(e.transaction_date || '').slice(0, 10);
    if (ref.endsWith(':CLEAR')) {
      const base = ref.slice(0, -':CLEAR'.length);
      const prev = clearDateByRef.get(base);
      if (!prev || d < prev) clearDateByRef.set(base, d);
    } else {
      openByRef.set(ref, (openByRef.get(ref) ?? 0) + Number(e.total_net_value ?? 0));
    }
  }

  let sum = 0;
  for (const [base, amount] of openByRef) {
    const clearDate = clearDateByRef.get(base);
    if (clearDate && clearDate <= asOfDate && Math.abs(amount) >= 0.005) sum += amount;
  }
  return Math.round(sum * 100) / 100;
}

/** Saldo em conta corrente liquidado (extrato): caixa regular + pending já liquidado. */
export function settledCashBalanceFromLedger(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  const asOf = (asOfDate || new Date().toISOString()).slice(0, 10);
  const base = cashBalanceFromLedger(entries, asOf);
  const clearedPending = sumClearedPendingOnCash(entries, asOf);
  return Math.round((base + clearedPending) * 100) / 100;
}

/** Saldo para exibição = conta corrente liquidada. */
export function resolveCashInvestDisplayBalance(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  return settledCashBalanceFromLedger(entries, asOfDate);
}
