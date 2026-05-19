import { PIVOT_COLUMNS, type PivotColumnKey, type PivotRow } from './ledgerTypes';
import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';

function emptyPivotRow(underlying: string, label: string): PivotRow {
  const row = { underlying, label } as PivotRow;
  for (const col of PIVOT_COLUMNS) row[col] = 0;
  return row;
}

function expenseAmount(e: LedgerEvent): number {
  return (
    Math.abs(Number(e.brokerage_fee ?? 0)) +
    Math.abs(Number(e.b3_fees ?? 0)) +
    Math.abs(Number(e.irrf_tax ?? 0))
  );
}

function netCash(e: LedgerEvent): number {
  return Number(e.total_net_value ?? 0);
}

function underlyingOf(e: LedgerEvent): string {
  return String(e.underlying_ticker || e.asset_ticker || '—').toUpperCase();
}

type PivotCellMapping = {
  column: Exclude<PivotColumnKey, 'total'>;
  amount: number;
} | null;

function pivotColumnForEntry(e: LedgerEvent, avgCostBeforeSell: number): PivotCellMapping {
  const type = String(e.transaction_type);
  const assetType = String(e.asset_type || 'stock');
  const net = netCash(e);
  const qty = Math.abs(Number(e.quantity));

  switch (type) {
    case 'dividend':
      return { column: 'dividendos', amount: net };
    case 'jcp':
      return { column: 'jcp', amount: net };
    case 'put_sell':
      return { column: 'put_vendida', amount: net };
    case 'put_buy':
      return { column: 'put_comprada', amount: net };
    case 'call_sell':
      return { column: 'call_vendida', amount: net };
    case 'call_buy':
      return { column: 'call_comprada', amount: net };
    case 'securities_lending':
      return { column: 'locacao', amount: net };
    case 'fee':
      return { column: 'despesas', amount: Math.abs(net) };
    case 'capital_deposit':
      return { column: 'capital_entrada', amount: Math.abs(net) };
    case 'capital_withdrawal':
      return { column: 'capital_saida', amount: -Math.abs(net) };
    case 'cash_yield':
      return { column: 'rendimento_caixa', amount: net };
    case 'penalty_b3':
      return { column: 'multas_b3', amount: -Math.abs(net) };
    case 'sell':
    case 'option_exercise':
      if (assetType === 'option_put') return { column: 'put_vendida', amount: net };
      if (assetType === 'option_call') return { column: 'call_vendida', amount: net };
      if (assetType === 'stock' || assetType === 'fii') {
        const cost = qty * avgCostBeforeSell;
        return { column: 'acao_ganho', amount: net - cost };
      }
      return { column: 'acao_ganho', amount: net };
    case 'buy':
      if (assetType === 'option_put') return { column: 'put_comprada', amount: net };
      if (assetType === 'option_call') return { column: 'call_comprada', amount: net };
      return null;
    default:
      return null;
  }
}

export type PnLPivotResult = {
  from: string;
  to: string;
  rows: PivotRow[];
  totals: PivotRow;
  custody: ReturnType<typeof rebuildCustodyFromLedger>;
};

/**
 * Agrega livro-razão em matriz pivot (linha = ativo mãe / underlying).
 */
export function buildPnLPivot(
  entries: LedgerEvent[],
  from: string,
  to: string
): PnLPivotResult {
  const rowsMap = new Map<string, PivotRow>();
  const custodyStates = new Map<string, { qty: number; totalCost: number }>();

  const getAvg = (assetId: string): number => {
    const s = custodyStates.get(assetId);
    if (!s || s.qty <= 0) return 0;
    return s.totalCost / s.qty;
  };

  const applyCustody = (e: LedgerEvent) => {
    if (e.impacts_managerial_price === false || e.impacts_managerial_price === 0) return;
    const type = String(e.transaction_type);
    let s = custodyStates.get(e.asset_id);
    if (!s) {
      s = { qty: 0, totalCost: 0 };
      custodyStates.set(e.asset_id, s);
    }
    const qty = Math.abs(Number(e.quantity));
    if (['buy', 'put_buy', 'call_buy', 'opening_balance', 'bonus'].includes(type)) {
      s.totalCost += qty * Number(e.unit_price);
      s.qty += qty;
    } else if (['sell', 'put_sell', 'call_sell', 'option_exercise'].includes(type)) {
      const avg = s.qty > 0 ? s.totalCost / s.qty : 0;
      const used = Math.min(qty, s.qty);
      s.totalCost -= used * avg;
      s.qty -= used;
    }
  };

  const getRow = (underlying: string, label?: string): PivotRow => {
    const key = underlying || '—';
    let row = rowsMap.get(key);
    if (!row) {
      row = emptyPivotRow(key, label || key);
      rowsMap.set(key, row);
    }
    return row;
  };

  for (const e of entries) {
    const und = underlyingOf(e);
    const row = getRow(und, und);
    const avgBefore = getAvg(e.asset_id);
    const mapped = pivotColumnForEntry(e, avgBefore);

    if (mapped?.column) {
      const col = mapped.column;
      row[col] = Math.round((row[col] + mapped.amount) * 100) / 100;
    }

    const exp = expenseAmount(e as LedgerEvent & { brokerage_fee?: number });
    if (exp > 0 && String(e.transaction_type) !== 'fee') {
      row.despesas = Math.round((row.despesas + exp) * 100) / 100;
    }

    applyCustody(e);
  }

  const rows = Array.from(rowsMap.values()).map((row) => {
    let total = 0;
    for (const col of PIVOT_COLUMNS) {
      if (col === 'total') continue;
      total += row[col];
    }
    row.total = Math.round(total * 100) / 100;
    return row;
  });

  rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  const totals = emptyPivotRow('TOTAL', 'Total geral');
  for (const row of rows) {
    for (const col of PIVOT_COLUMNS) {
      if (col === 'total') continue;
      totals[col] = Math.round((totals[col] + row[col]) * 100) / 100;
    }
  }
  totals.total = Math.round(
    PIVOT_COLUMNS.filter((c) => c !== 'total').reduce((s, c) => s + totals[c], 0) * 100
  ) / 100;

  const custody = rebuildCustodyFromLedger(entries);

  return { from, to, rows, totals, custody };
}
