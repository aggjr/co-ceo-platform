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

const NOTE_REF_PREFIX_RE = /^(B3|BTG)-NOTA-/;

/**
 * Perna de trânsito da NOTA: prêmio/exercício/taxa que a nota registra como
 * `pending_settlement` antes do extrato confirmar. O extrato é a verdade do caixa
 * liquidado, então essa perna não entra no saldo liquidado (apenas no trânsito).
 */
function isNotePending(e: LedgerEvent): boolean {
  return (
    String(e.transaction_type) === 'pending_settlement' &&
    NOTE_REF_PREFIX_RE.test(String(e.broker_note_ref || ''))
  );
}

/** Mesma regra do extrato BTG na UI: ignora abertura manual duplicada quando já há BTG-EXTRATO-OPENING. */
export function cashLedgerEventsForBalance(
  entries: LedgerEvent[] | null | undefined,
  options?: { includeAutoPending?: boolean; excludeNotePending?: boolean }
): LedgerEvent[] {
  const cashOnly = (entries || []).filter((e) =>
    isCashInvestTicker(String(e.asset_ticker || ''))
  );
  return cashOnly.filter(
    (e) =>
      !isDuplicateManualOpeningCash(e, cashOnly) &&
      (options?.includeAutoPending || !isAutoPending(e)) &&
      (!options?.excludeNotePending || !isNotePending(e))
  );
}

/**
 * Eventos com perna REALIZADA no extrato (qualquer perna de caixa que não seja
 * trânsito: não-AUTO-D2 e não-pending-de-nota). Usado para suprimir a baixa AUTO-D2
 * quando o próprio extrato já trouxe a perna liquidada do mesmo evento.
 */
function realizedExtractEventIds(
  entries: LedgerEvent[] | null | undefined,
  asOfDate: string
): Set<string> {
  const ids = new Set<string>();
  for (const e of cashLedgerEventsForBalance(entries, { excludeNotePending: true })) {
    if (isAutoPending(e)) continue;
    const d = String(e.transaction_date || '').slice(0, 10);
    if (d && d > asOfDate) continue;
    const eid = String((e as { business_event_id?: unknown }).business_event_id ?? '');
    if (eid) ids.add(eid);
  }
  return ids;
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
  asOfDate: string,
  realizedEventIds: Set<string>
): number {
  const openByRef = new Map<string, number>();
  const clearDateByRef = new Map<string, string>();
  const eventByRef = new Map<string, string>();

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
      const eid = String((e as { business_event_id?: unknown }).business_event_id ?? '');
      if (eid) eventByRef.set(ref, eid);
    }
  }

  let sum = 0;
  for (const [base, amount] of openByRef) {
    // Extrato é a verdade: se o mesmo evento já tem perna realizada no extrato,
    // a baixa do trânsito AUTO-D2 seria double-count — não soma.
    const eid = eventByRef.get(base);
    if (eid && realizedEventIds.has(eid)) continue;
    const clearDate = clearDateByRef.get(base);
    if (clearDate && clearDate <= asOfDate && Math.abs(amount) >= 0.005) sum += amount;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Saldo em conta corrente liquidado (extrato é a verdade do caixa): soma das pernas
 * REALIZADAS (extrato + abertura), excluindo trânsito (pending de nota e AUTO-D2).
 * A baixa AUTO-D2 só entra para eventos sem perna realizada do extrato (fluxo em que
 * o trânsito é o único registro da liquidação).
 */
export function settledCashBalanceFromLedger(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  const asOf = (asOfDate || new Date().toISOString()).slice(0, 10);
  let base = 0;
  for (const e of cashLedgerEventsForBalance(entries, { excludeNotePending: true })) {
    const d = String(e.transaction_date || '').slice(0, 10);
    if (d && d > asOf) continue;
    base += Number(e.total_net_value ?? 0);
  }
  base = Math.round(base * 100) / 100;
  const clearedPending = sumClearedPendingOnCash(entries, asOf, realizedExtractEventIds(entries, asOf));
  return Math.round((base + clearedPending) * 100) / 100;
}

/** Saldo para exibição = conta corrente liquidada. */
export function resolveCashInvestDisplayBalance(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): number {
  return settledCashBalanceFromLedger(entries, asOfDate);
}
