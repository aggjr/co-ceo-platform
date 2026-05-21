import * as XLSX from 'xlsx';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
import {
  myProfitRowsToLedgerLines,
  parseMyProfitHistoricalRows,
  type MyProfitRow,
} from './MyProfitHistoricalParser';
import type { LedgerImportLine } from './ledgerTypes';

/** Nota de corretagem BTG Pactual (home broker) — única fonte aceita para RV/opções. */
export function isBtgHomeBrokerRef(ref: string | null | undefined): boolean {
  const r = String(ref || '').trim().toUpperCase();
  if (r.startsWith('B3_ALUGUEL')) return false;
  return r.startsWith('B3_BTG') || (r.includes('BTG PACTUAL') && !r.includes('ALUGUEL'));
}

export function isBtgHomeBrokerRow(row: MyProfitRow): boolean {
  const inst = String(row.institution || '').toUpperCase();
  const doc = String(row.document || '').toUpperCase();
  return inst.includes('BTG') || doc.includes('BTG PACTUAL');
}

/** Normaliza underlying (ITUB4, não ITUB3) e rótulos de origem. */
export function normalizeBtgHomeBrokerLine(line: LedgerImportLine): LedgerImportLine {
  const ticker = line.ticker.trim().toUpperCase();
  const underlying = inferUnderlyingTicker(ticker, line.underlying_ticker);
  let notes = String(line.notes || '').trim();
  if (!notes) {
    notes = `BTG home broker — ${ticker}`;
  } else if (/^myprofit/i.test(notes)) {
    notes = notes.replace(/^myprofit/i, 'BTG home broker');
  } else if (!notes.toLowerCase().includes('btg')) {
    notes = `BTG home broker — ${notes}`;
  }
  return {
    ...line,
    ticker,
    asset_type: line.asset_type || inferAssetType(ticker),
    underlying_ticker: underlying,
    notes,
  };
}

/**
 * Converte linhas do relatório exportado (formato myProfit) em lançamentos,
 * aceitando **somente** notas BTG Pactual. Ignora Tesouro e locação (extrato BTG).
 */
export function btgHomeBrokerRowsToLedgerLines(
  rows: MyProfitRow[],
  options?: { skipDocuments?: Set<string> }
): LedgerImportLine[] {
  const btgRows = rows.filter(isBtgHomeBrokerRow);
  const lines = myProfitRowsToLedgerLines(btgRows, {
    skipDocuments: options?.skipDocuments,
    skipGroups: ['Tesouro Direto'],
  });
  return lines.filter((l) => isBtgHomeBrokerRef(l.broker_note_ref)).map(normalizeBtgHomeBrokerLine);
}

export function parseBtgHomeBrokerHistoricalFile(
  filePath: string,
  options?: { fromDate?: string; skipDocuments?: Set<string> }
): LedgerImportLine[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  const rows = parseMyProfitHistoricalRows(
    raw,
    options?.fromDate ? { fromDate: options.fromDate } : undefined
  );
  return btgHomeBrokerRowsToLedgerLines(rows, {
    skipDocuments: options?.skipDocuments,
  });
}

/** Normaliza um payload JSON já materializado (migração myProfit → BTG). */
export function normalizeBtgOrdersPayload(entries: LedgerImportLine[]): LedgerImportLine[] {
  return entries
    .filter((l) => isBtgHomeBrokerRef(l.broker_note_ref))
    .map(normalizeBtgHomeBrokerLine);
}
