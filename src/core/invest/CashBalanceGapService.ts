import type { UserContext } from '../dal';
import type { LedgerEvent } from './CustodyEngine';
import type { BrokerCustodySnapshotRecord } from './brokerCustodySnapshotTypes';
import { settledCashBalanceFromLedger } from './cashInvestLedger';
import {
  dayBefore,
  lastDayOfPreviousMonth,
  MONTH_IMPORT_CASH_TOLERANCE,
  type ExtractReconcileFields,
} from './btgExtractBatchReconcile';
import type { LedgerImportService } from './LedgerImportService';
import { MAIN_CASH_TICKER, type LedgerImportLine } from './ledgerTypes';

/** Residuo minimo para gerar pendencia (abaixo disso considera arredondamento). */
export const CASH_BALANCE_GAP_TOLERANCE = 0.05;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function gapEventSourceRef(asOf: string, centsSigned: number): string {
  return `BTG-GAP:${asOf}:settled:${centsSigned}`;
}

function hasExistingGapRef(events: LedgerEvent[], ref: string): boolean {
  const target = ref.trim();
  if (!target) return false;
  return events.some((e) => {
    const noteRef = String(e.broker_note_ref || '').trim();
    const sourceRef = String((e as LedgerEvent & { event_source_ref?: string }).event_source_ref || '').trim();
    return noteRef === target || sourceRef === target || noteRef.startsWith(`${target}:`);
  });
}

/**
 * Monta linha de import quando saldo liquidado do sistema difere do snapshot da corretora.
 * gap = brokerCash - systemSettled (positivo aumenta caixa no livro).
 */
export function buildCashBalanceGapLine(
  asOf: string,
  brokerCash: number,
  systemSettled: number,
  cashTicker = MAIN_CASH_TICKER
): LedgerImportLine | null {
  const gap = roundMoney(brokerCash - systemSettled);
  if (Math.abs(gap) <= CASH_BALANCE_GAP_TOLERANCE) return null;
  const centsSigned = Math.round(gap * 100);
  const ref = gapEventSourceRef(asOf, centsSigned);
  return {
    date: asOf,
    ticker: cashTicker,
    operation: 'cash_balance_gap',
    quantity: 0,
    unit_price: 0,
    total_net_value: gap,
    asset_type: 'cash',
    broker_note_ref: ref,
    event_source_ref: ref,
    source_system: 'cash_balance_gap_reconcile',
    settlement_status: 'cleared',
    extract_category: 3,
    notes:
      `Residuo caixa: sistema R$ ${systemSettled.toFixed(2)} vs corretora R$ ${brokerCash.toFixed(2)} ` +
      `(delta R$ ${gap.toFixed(2)})`,
  };
}

export function buildCashBalanceGapLineFromDelta(
  asOf: string,
  delta: number,
  cashTicker = MAIN_CASH_TICKER
): LedgerImportLine | null {
  const gap = roundMoney(delta);
  if (Math.abs(gap) <= CASH_BALANCE_GAP_TOLERANCE) return null;
  const centsSigned = Math.round(gap * 100);
  const ref = gapEventSourceRef(asOf, centsSigned);
  return {
    date: asOf,
    ticker: cashTicker,
    operation: 'cash_balance_gap',
    quantity: 0,
    unit_price: 0,
    total_net_value: gap,
    asset_type: 'cash',
    broker_note_ref: ref,
    event_source_ref: ref,
    source_system: 'cash_balance_gap_month_import',
    settlement_status: 'cleared',
    extract_category: 3,
    notes: `Residuo de batimento mensal (delta R$ ${gap.toFixed(2)})`,
  };
}

/**
 * Gera `cash_balance_gap` idempotente quando snapshot broker confirma divergencia de caixa liquidado.
 */
export async function ensureCashBalanceGapsFromSnapshot(
  ctx: UserContext,
  ledger: LedgerImportService,
  events: LedgerEvent[],
  snapshot: BrokerCustodySnapshotRecord | null,
  asOf: string
): Promise<{ created: number; skipped: number; gapAmount: number | null }> {
  const brokerCash = snapshot?.composition?.cash;
  if (brokerCash == null || Number.isNaN(Number(brokerCash))) {
    return { created: 0, skipped: 0, gapAmount: null };
  }

  const asOfNorm = asOf.slice(0, 10);
  const systemSettled = settledCashBalanceFromLedger(events, asOfNorm);
  const line = buildCashBalanceGapLine(asOfNorm, Number(brokerCash), systemSettled);
  if (!line?.event_source_ref) {
    return { created: 0, skipped: 0, gapAmount: null };
  }

  if (hasExistingGapRef(events, line.event_source_ref)) {
    return { created: 0, skipped: 1, gapAmount: line.total_net_value ?? null };
  }

  const result = await ledger.importEntriesOnly(ctx, [line], { sourceLabel: 'gap snapshot' });
  return {
    created: result.inserted,
    skipped: result.skipped,
    gapAmount: line.total_net_value ?? null,
  };
}

/**
 * Residuo dentro de MONTH_IMPORT_CASH_TOLERANCE ainda vira pendencia (nao e descartado).
 */
export async function ensureMonthImportCashBalanceGaps(
  ctx: UserContext,
  ledger: LedgerImportService,
  reconcile: ExtractReconcileFields,
  month: string,
  firstDate?: string | null
): Promise<{ created: number; skipped: number }> {
  const lines: LedgerImportLine[] = [];

  const openingDelta = reconcile.openingLedgerDelta;
  if (
    openingDelta != null &&
    Math.abs(openingDelta) > CASH_BALANCE_GAP_TOLERANCE &&
    Math.abs(openingDelta) <= MONTH_IMPORT_CASH_TOLERANCE
  ) {
    const openingAsOf = firstDate ? dayBefore(firstDate) : lastDayOfPreviousMonth(month);
    const line = buildCashBalanceGapLineFromDelta(openingAsOf, openingDelta);
    if (line) lines.push(line);
  }

  const closingDelta = reconcile.closingLedgerDelta;
  if (
    closingDelta != null &&
    Math.abs(closingDelta) > CASH_BALANCE_GAP_TOLERANCE &&
    Math.abs(closingDelta) <= MONTH_IMPORT_CASH_TOLERANCE &&
    reconcile.closingDate
  ) {
    const line = buildCashBalanceGapLineFromDelta(reconcile.closingDate.slice(0, 10), closingDelta);
    if (line) lines.push(line);
  }

  if (!lines.length) return { created: 0, skipped: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const pending = lines.filter((line) => !hasExistingGapRef(events, String(line.event_source_ref || '')));
  if (!pending.length) return { created: 0, skipped: lines.length };

  const result = await ledger.importEntriesOnly(ctx, pending, { sourceLabel: 'gap mes' });
  return { created: result.inserted, skipped: result.skipped + (lines.length - pending.length) };
}
