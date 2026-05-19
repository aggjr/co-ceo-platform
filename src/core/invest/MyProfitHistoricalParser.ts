import * as XLSX from 'xlsx';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
import { canonicalTesouroTicker } from './tesouroDirectLedger';
import { mapBrokerOrderToLedger } from './brokerOrderMapper';
import type { LedgerImportLine } from './ledgerTypes';

export type MyProfitRow = {
  date: string;
  institution: string;
  document: string;
  fees: number;
  ticker: string;
  group: string;
  quantity: number;
  flow: string;
  side: string;
  unitPrice: number;
  unitPriceWithFees: number;
  totalGross: number;
  totalNet: number;
  obs: string;
};

function excelDateToIso(value: unknown): string {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return '';
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(value || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

function normalizeTicker(asset: string, group: string): string {
  const t = asset.trim().toUpperCase();
  if (group === 'Tesouro Direto') {
    if (/SELIC\s*2031/i.test(asset)) return canonicalTesouroTicker('TESOURO-SELIC-2031');
    if (/LFT/i.test(asset)) return canonicalTesouroTicker('LFT-20310301');
    return canonicalTesouroTicker(`TD-${t.replace(/\s+/g, '-')}`);
  }
  return t;
}

function directionFromRow(side: string, quantity: number): 'C' | 'V' {
  const s = side.trim().toLowerCase();
  if (s.startsWith('compra')) return 'C';
  if (s.startsWith('venda')) return 'V';
  return quantity < 0 ? 'V' : 'C';
}

export function parseMyProfitHistoricalRows(
  sheetRows: unknown[][],
  options?: { fromDate?: string }
): MyProfitRow[] {
  const fromDate = options?.fromDate?.trim() || null;
  let headerIdx = sheetRows.findIndex(
    (r) => String(r[0] || '').trim() === 'Data de negociação'
  );
  if (headerIdx < 0) headerIdx = 4;
  const out: MyProfitRow[] = [];

  for (const row of sheetRows.slice(headerIdx + 1)) {
    const tickerRaw = String(row[6] || '').trim();
    if (!tickerRaw || tickerRaw === 'Ativo') continue;

    const date = excelDateToIso(row[0]);
    if (!date || (fromDate && date < fromDate)) continue;

    const group = String(row[7] || '').trim();
    const quantity = Number(row[8]);
    if (!quantity) continue;

    const col2 = String(row[2] || '').trim();
    const col3 = String(row[3] || '').trim();
    const document = col3 || col2;
    const brokerRef = `${document}#${tickerRaw}#${date}#${quantity}#${String(row[10] || '').trim()}`;

    out.push({
      date,
      institution: String(row[1] || '').trim(),
      document: brokerRef,
      fees: Math.abs(Number(row[5] || 0)),
      ticker: normalizeTicker(tickerRaw, group),
      group,
      quantity,
      flow: String(row[9] || '').trim(),
      side: String(row[10] || '').trim(),
      unitPrice: Number(row[11] || 0),
      unitPriceWithFees: Number(row[12] || 0),
      totalGross: Number(row[13] || 0),
      totalNet: Number(row[14] || 0),
      obs: String(row[15] || '').trim(),
    });
  }

  return out;
}

function mapStockRow(row: MyProfitRow): LedgerImportLine {
  const qty = Math.abs(row.quantity);
  const isBuy = directionFromRow(row.side, row.quantity) === 'C';
  const gross = qty * row.unitPrice;
  return {
    date: row.date,
    ticker: row.ticker,
    asset_type: 'stock',
    underlying_ticker: row.ticker,
    operation: isBuy ? 'buy' : 'sell',
    quantity: qty,
    unit_price: row.unitPrice,
    total_net_value: row.totalNet,
    brokerage_fee: row.fees,
    broker_note_ref: row.document,
    notes: `myProfit — ${row.ticker} ${row.side}`,
    impacts_managerial_price: true,
  };
}

function mapTesouroRow(row: MyProfitRow): LedgerImportLine {
  const qty = Math.abs(row.quantity);
  const isBuy = directionFromRow(row.side, row.quantity) === 'C';
  return {
    date: row.date,
    ticker: row.ticker,
    asset_type: 'fixed_income',
    operation: isBuy ? 'buy' : 'sell',
    quantity: qty,
    unit_price: row.unitPrice || 1,
    total_net_value: row.totalNet,
    brokerage_fee: row.fees,
    broker_note_ref: row.document,
    notes: `myProfit — ${row.group}`,
    impacts_managerial_price: true,
  };
}

function mapAluguelRow(row: MyProfitRow): LedgerImportLine | null {
  if (!row.document.includes('ALUGUEL')) return null;
  return {
    date: row.date,
    ticker: row.ticker,
    asset_type: 'stock',
    underlying_ticker: inferUnderlyingTicker(row.ticker),
    operation: 'securities_lending',
    quantity: 0,
    unit_price: 0,
    total_net_value: row.totalNet,
    broker_note_ref: row.document,
    notes: `myProfit — locação ${row.ticker}`,
    impacts_managerial_price: false,
  };
}

/**
 * Converte linhas do relatório histórico myProfit em lançamentos do livro-razão.
 * Ignora dez/2025 (já coberto pela abertura 01/01/2026).
 */
export function myProfitRowsToLedgerLines(
  rows: MyProfitRow[],
  options?: { skipDocuments?: Set<string>; skipGroups?: string[] }
): LedgerImportLine[] {
  const skip = options?.skipDocuments || new Set<string>();
  const skipGroups = new Set(options?.skipGroups || ['Tesouro Direto']);
  const lines: LedgerImportLine[] = [];

  for (const row of rows) {
    if (!row.document || skip.has(row.document)) continue;
    if (skipGroups.has(row.group)) continue;

    if (row.document.includes('ALUGUEL')) {
      const lending = mapAluguelRow(row);
      if (lending) lines.push(lending);
      continue;
    }

    if (row.group === 'Tesouro Direto') {
      lines.push(mapTesouroRow(row));
      continue;
    }

    if (row.group === 'Ações') {
      lines.push(mapStockRow(row));
      continue;
    }

    if (row.group === 'Opções') {
      if (row.ticker.endsWith('E')) {
        const dir = directionFromRow(row.side, row.quantity);
        const mapped = mapBrokerOrderToLedger({
          ticker: row.ticker,
          direction: dir,
          quantity: Math.abs(row.quantity),
          avgPrice: row.unitPrice,
          date: row.date,
          broker_note_ref: row.document,
        });
        for (const line of mapped) {
          lines.push({
            ...line,
            brokerage_fee: row.fees,
            broker_note_ref: row.document,
            notes: line.notes ?? `myProfit exercício — ${row.ticker}`,
          });
        }
        continue;
      }

      const dir = directionFromRow(row.side, row.quantity);
      const mapped = mapBrokerOrderToLedger({
        ticker: row.ticker,
        direction: dir,
        quantity: Math.abs(row.quantity),
        avgPrice: row.unitPrice,
        date: row.date,
        broker_note_ref: row.document,
      });
      for (const line of mapped) {
        lines.push({
          ...line,
          brokerage_fee: row.fees,
          total_net_value: line.total_net_value ?? row.totalNet,
        });
      }
      continue;
    }

    const assetType = inferAssetType(row.ticker);
    if (assetType === 'stock') {
      lines.push(mapStockRow(row));
    }
  }

  return lines;
}

export function parseMyProfitHistoricalFile(
  filePath: string,
  options?: { fromDate?: string; skipDocuments?: Set<string>; skipGroups?: string[] }
): LedgerImportLine[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  const rows = parseMyProfitHistoricalRows(
    raw,
    options?.fromDate ? { fromDate: options.fromDate } : undefined
  );
  return myProfitRowsToLedgerLines(rows, { skipDocuments: options?.skipDocuments });
}
