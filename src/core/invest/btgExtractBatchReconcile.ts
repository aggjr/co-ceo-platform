/**
 * Batimento mensal de extratos BTG: cadeia saldo inicial/final entre arquivos e vs livro.
 */
import type { LedgerEvent } from './CustodyEngine';
import { settledCashBalanceFromLedger } from './cashInvestLedger';
import type { BtgExtractImportPreview } from './btgUploadImportService';

export const CASH_RECON_TOLERANCE = 0.01;

export type ParsedExtractForBatch = {
  path: string;
  fileName: string;
  preview: BtgExtractImportPreview;
};

export function moneyMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= CASH_RECON_TOLERANCE;
}

export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function lastDayOfPreviousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM a partir do nome do arquivo ou do período do extrato. */
export function inferExtractMonth(
  fileName: string,
  firstDate: string | null,
  lastDate: string | null
): string | null {
  const base = fileName.replace(/\\/g, '/');
  const m1 = base.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])/);
  if (m1) return `${m1[1]}-${m1[2]}`;
  const m2 = base.match(/(0[1-9]|1[0-2])[-_.]?(20\d{2})/);
  if (m2) return `${m2[2]}-${m2[1]}`;
  if (firstDate && lastDate) {
    const fm = firstDate.slice(0, 7);
    const lm = lastDate.slice(0, 7);
    return fm === lm ? fm : fm;
  }
  return firstDate?.slice(0, 7) ?? null;
}

export function isExtractMonthInLedger(events: LedgerEvent[], month: string): boolean {
  if (!month) return false;
  for (const e of events) {
    const d = String(e.transaction_date || '').slice(0, 7);
    if (d !== month) continue;
    const ref = String(e.broker_note_ref || '');
    if (ref.startsWith('BTG-EXT-')) return true;
  }
  return false;
}

export function sortParsedExtracts(items: ParsedExtractForBatch[]): ParsedExtractForBatch[] {
  return [...items].sort((a, b) => {
    const ma = inferExtractMonth(a.fileName, a.preview.firstDate, a.preview.lastDate) || '';
    const mb = inferExtractMonth(b.fileName, b.preview.firstDate, b.preview.lastDate) || '';
    if (ma !== mb) return ma.localeCompare(mb);
    const da = a.preview.firstDate || '';
    const db = b.preview.firstDate || '';
    return da.localeCompare(db) || a.path.localeCompare(b.path);
  });
}

export type ExtractReconcileFields = {
  month: string | null;
  openingExtract: number;
  closingExtract: number | null;
  closingDate: string | null;
  openingChainOk: boolean | null;
  openingChainDelta: number | null;
  openingLedgerOk: boolean | null;
  openingLedgerBalance: number | null;
  openingLedgerDelta: number | null;
  closingLedgerOk: boolean | null;
  closingLedgerBalance: number | null;
  closingLedgerDelta: number | null;
  monthAlreadyImported: boolean;
};

export function buildExtractReconcileFields(
  parsed: ParsedExtractForBatch,
  ledgerEvents: LedgerEvent[],
  previousClosingExtract: number | null
): ExtractReconcileFields {
  const { preview } = parsed;
  const month =
    inferExtractMonth(parsed.fileName, preview.firstDate, preview.lastDate) ||
    preview.firstDate?.slice(0, 7) ||
    null;

  const openingExtract = preview.openingBalance;
  const closingExtract = preview.lastExtractBalance;
  const closingDate = preview.lastDate;

  let openingChainOk: boolean | null = null;
  let openingChainDelta: number | null = null;
  if (previousClosingExtract != null) {
    openingChainDelta = Math.round((openingExtract - previousClosingExtract) * 100) / 100;
    openingChainOk = moneyMatch(openingExtract, previousClosingExtract);
  }

  let openingLedgerOk: boolean | null = null;
  let openingLedgerBalance: number | null = null;
  let openingLedgerDelta: number | null = null;
  if (preview.firstDate) {
    const asOf = dayBefore(preview.firstDate);
    openingLedgerBalance = settledCashBalanceFromLedger(ledgerEvents, asOf);
    openingLedgerDelta = Math.round((openingExtract - openingLedgerBalance) * 100) / 100;
    openingLedgerOk = moneyMatch(openingExtract, openingLedgerBalance);
  } else if (month) {
    const asOf = lastDayOfPreviousMonth(month);
    openingLedgerBalance = settledCashBalanceFromLedger(ledgerEvents, asOf);
    openingLedgerDelta = Math.round((openingExtract - openingLedgerBalance) * 100) / 100;
    openingLedgerOk = moneyMatch(openingExtract, openingLedgerBalance);
  }

  let closingLedgerOk: boolean | null = null;
  let closingLedgerBalance: number | null = null;
  let closingLedgerDelta: number | null = null;
  if (closingDate && closingExtract != null) {
    closingLedgerBalance = settledCashBalanceFromLedger(ledgerEvents, closingDate);
    closingLedgerDelta = Math.round((closingExtract - closingLedgerBalance) * 100) / 100;
    closingLedgerOk = moneyMatch(closingExtract, closingLedgerBalance);
  }

  const monthAlreadyImported = month ? isExtractMonthInLedger(ledgerEvents, month) : false;

  return {
    month,
    openingExtract,
    closingExtract,
    closingDate,
    openingChainOk,
    openingChainDelta,
    openingLedgerOk,
    openingLedgerBalance,
    openingLedgerDelta,
    closingLedgerOk,
    closingLedgerBalance,
    closingLedgerDelta,
    monthAlreadyImported,
  };
}

export function batchChainIntact(
  fileResults: Array<{ openingChainOk?: boolean | null; parseOk?: boolean }>
): boolean {
  for (const r of fileResults) {
    if (!r.parseOk) continue;
    if (r.openingChainOk === false) return false;
  }
  return true;
}
