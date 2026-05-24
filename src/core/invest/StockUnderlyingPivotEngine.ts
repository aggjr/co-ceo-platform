import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';

/** Colunas do pivot por ação (underlying). */
export const STOCK_PIVOT_COLUMNS = [
  'ganho_aproximado',
  'venda_call',
  'compra_call',
  'venda_put',
  'compra_put',
  'dividendos',
  'jcp',
  'locacao_acao',
  'trade',
  'day_trade',
  'bonus',
  'outros_ganhos',
  'taxas',
] as const;

export type StockPivotColumnKey = (typeof STOCK_PIVOT_COLUMNS)[number];

export const STOCK_PIVOT_COLUMN_LABELS: Record<StockPivotColumnKey, string> = {
  venda_call: 'Venda call',
  compra_call: 'Compra call',
  venda_put: 'Venda put',
  compra_put: 'Compra put',
  dividendos: 'Dividendos',
  jcp: 'JCP',
  locacao_acao: 'Locação ação',
  trade: 'Trade',
  day_trade: 'Day trade',
  bonus: 'Bonificação',
  outros_ganhos: 'Outros ganhos',
  taxas: 'Taxas (todas)',
  ganho_aproximado: 'Total',
};

export type StockPivotRow = Record<StockPivotColumnKey, number> & {
  underlying: string;
  label: string;
  /** Preço médio estrito (custo gerencial) da ação no fim do período. */
  preco_estrito: number | null;
  /** Cotação de mercado atual (metadata), se disponível. */
  cotacao_atual: number | null;
};

function emptyRow(underlying: string): StockPivotRow {
  const row = {
    underlying,
    label: underlying,
    preco_estrito: null,
    cotacao_atual: null,
  } as StockPivotRow;
  for (const col of STOCK_PIVOT_COLUMNS) row[col] = 0;
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
  const explicit = e.underlying_ticker?.trim();
  if (explicit) return explicit.toUpperCase();
  const ticker = String(e.asset_ticker || '').toUpperCase();
  const type = String(e.asset_type || inferAssetType(ticker));
  if (type === 'option_call' || type === 'option_put') {
    return inferUnderlyingTicker(ticker, explicit);
  }
  return ticker;
}

function isStockUnderlying(ticker: string): boolean {
  const t = ticker.toUpperCase();
  if (!t || t.startsWith('CAIXA') || t.startsWith('TESOURO') || t.startsWith('LFT-')) return false;
  return /^[A-Z]{4}(3|4|8|11)$/.test(t);
}

function addToRow(row: StockPivotRow, col: StockPivotColumnKey, amount: number): void {
  row[col] = Math.round((row[col] + amount) * 100) / 100;
}

export type StockUnderlyingPivotResult = {
  from: string;
  to: string;
  rows: StockPivotRow[];
  totals: StockPivotRow;
};

/**
 * Pivot de ganhos aproximados por ação (underlying), com colunas dinâmicas estilo Excel.
 */
export function buildStockUnderlyingPivot(
  entries: LedgerEvent[],
  from: string,
  to: string
): StockUnderlyingPivotResult {
  const rowsMap = new Map<string, StockPivotRow>();
  const custodyStates = new Map<string, { qty: number; totalCost: number }>();
  const sameDayBuys = new Map<string, Map<string, number>>();

  const getRow = (underlying: string): StockPivotRow => {
    const key = underlying || '—';
    let row = rowsMap.get(key);
    if (!row) {
      row = emptyRow(key);
      rowsMap.set(key, row);
    }
    return row;
  };

  const getAvg = (assetId: string): number => {
    const s = custodyStates.get(assetId);
    if (!s || s.qty <= 0) return 0;
    return s.totalCost / s.qty;
  };

  const applyCustody = (e: LedgerEvent): { closedQty: number; costBasisClosed: number; wasLong: boolean } => {
    let closedQty = 0;
    let costBasisClosed = 0;
    let wasLong = true;

    if (e.impacts_managerial_price === false || e.impacts_managerial_price === 0) {
      return { closedQty, costBasisClosed, wasLong };
    }
    const type = String(e.transaction_type);
    let s = custodyStates.get(e.asset_id);
    if (!s) {
      s = { qty: 0, totalCost: 0 };
      custodyStates.set(e.asset_id, s);
    }
    const qty = Math.abs(Number(e.quantity));
    const price = Number(e.unit_price);

    const isBuy = ['buy', 'put_buy', 'call_buy', 'opening_balance', 'bonus'].includes(type);
    const isSell = ['sell', 'put_sell', 'call_sell', 'option_exercise'].includes(type);

    if (isBuy) {
      if (s.qty < 0) {
        wasLong = false;
        const used = Math.min(qty, Math.abs(s.qty));
        const avg = s.totalCost / Math.abs(s.qty);
        s.totalCost -= used * avg;
        s.qty += used;
        closedQty = used;
        costBasisClosed = used * avg;
        const remainder = qty - used;
        if (remainder > 0) {
          s.qty += remainder;
          s.totalCost += remainder * price;
        }
        if (s.qty === 0) s.totalCost = 0;
      } else {
        s.qty += qty;
        s.totalCost += qty * price;
      }
    } else if (isSell) {
      if (s.qty > 0) {
        wasLong = true;
        const used = Math.min(qty, s.qty);
        const avg = s.totalCost / s.qty;
        s.totalCost -= used * avg;
        s.qty -= used;
        closedQty = used;
        costBasisClosed = used * avg;
        const remainder = qty - used;
        if (remainder > 0) {
          s.qty -= remainder;
          s.totalCost += remainder * price;
        }
        if (s.qty === 0) s.totalCost = 0;
      } else {
        s.qty -= qty;
        s.totalCost += qty * price;
      }
    }
    return { closedQty, costBasisClosed, wasLong };
  };

  const recordSameDayBuy = (underlying: string, date: string, qty: number) => {
    if (!sameDayBuys.has(underlying)) sameDayBuys.set(underlying, new Map());
    const m = sameDayBuys.get(underlying)!;
    m.set(date, Math.round(((m.get(date) || 0) + qty) * 10000) / 10000);
  };

  const consumeSameDayBuy = (underlying: string, date: string, qty: number): number => {
    const m = sameDayBuys.get(underlying);
    if (!m) return 0;
    const avail = m.get(date) || 0;
    const used = Math.min(qty, avail);
    if (used > 0) m.set(date, Math.round((avail - used) * 10000) / 10000);
    return used;
  };

  for (const e of entries) {
    const day = String(e.transaction_date || '').slice(0, 10);
    const und = underlyingOf(e);
    if (!isStockUnderlying(und)) continue;

    const row = getRow(und);
    const type = String(e.transaction_type);
    const assetType = String(e.asset_type || inferAssetType(String(e.asset_ticker)));
    const net = netCash(e);
    const qty = Math.abs(Number(e.quantity));
    
    const { closedQty, costBasisClosed, wasLong } = applyCustody(e);

    if (!day || day < from || day > to) continue;

    switch (type) {
      case 'dividend':
        addToRow(row, 'dividendos', net);
        break;
      case 'jcp':
        addToRow(row, 'jcp', net);
        break;
      case 'securities_lending':
        addToRow(row, 'locacao_acao', net);
        break;
      case 'bonus':
        addToRow(row, 'bonus', net);
        break;
      case 'fee':
      case 'penalty_b3':
        addToRow(row, 'taxas', Math.abs(net));
        break;
      case 'revaluation':
        addToRow(row, 'outros_ganhos', net);
        break;
      case 'put_sell':
      case 'put_buy':
      case 'call_sell':
      case 'call_buy':
      case 'sell':
      case 'buy':
      case 'option_exercise': {
        if (assetType === 'stock' || assetType === 'fii') {
          if (type === 'buy') {
            if (closedQty > 0 && !wasLong) {
               const netOfClosed = qty > 0 ? net * (closedQty / qty) : net;
               const pnl = netOfClosed + costBasisClosed; 
               addToRow(row, 'trade', pnl);
            }
            recordSameDayBuy(und, day, qty);
          } else if (type === 'sell' || type === 'option_exercise') {
            const dtQty = consumeSameDayBuy(und, day, qty);
            const swingQty = Math.max(0, qty - dtQty);
            const netPerShare = qty > 0 ? net / qty : 0;
            const costPerShare = closedQty > 0 ? costBasisClosed / closedQty : 0;

            if (dtQty > 0) {
              const pnlDt = (netPerShare * dtQty) - (costPerShare * dtQty);
              addToRow(row, 'day_trade', pnlDt);
            }
            if (swingQty > 0) {
              const pnlSw = (netPerShare * swingQty) - (costPerShare * swingQty);
              addToRow(row, 'trade', pnlSw);
            }
            if (dtQty === 0 && swingQty === 0 && qty > 0) {
              addToRow(row, 'trade', net - costBasisClosed);
            }
          }
        } else if (assetType === 'option_put' || assetType === 'option_call') {
          const isVenda = ['put_sell', 'call_sell', 'sell'].includes(type) && !['option_exercise'].includes(type);
          if (assetType === 'option_put') {
            if (isVenda) addToRow(row, 'venda_put', net);
            else addToRow(row, 'compra_put', net);
          } else {
            if (isVenda) addToRow(row, 'venda_call', net);
            else addToRow(row, 'compra_call', net);
          }
        }
        break;
      }
      default:
        if (net !== 0 && !['capital_deposit', 'capital_withdrawal', 'cash_yield', 'pending_settlement', 'opening_balance'].includes(type)) {
          addToRow(row, 'outros_ganhos', net);
        }
        break;
    }

    const exp = expenseAmount(e);
    if (exp > 0 && type !== 'fee') {
      addToRow(row, 'taxas', exp);
    }
  }

  const custody = rebuildCustodyFromLedger(entries);
  for (const pos of custody.assets) {
    const ticker = String(pos.underlying || pos.ticker || '').toUpperCase();
    if (!isStockUnderlying(ticker)) continue;
    const row = getRow(ticker);
    if (Math.abs(pos.quantity) > 0 && pos.avgPrice > 0) {
      row.preco_estrito = Math.round(pos.avgPrice * 10000) / 10000;
    }
  }

  const gainCols: StockPivotColumnKey[] = [
    'venda_call',
    'compra_call',
    'venda_put',
    'compra_put',
    'dividendos',
    'jcp',
    'locacao_acao',
    'trade',
    'day_trade',
    'bonus',
    'outros_ganhos',
  ];

  const rows = Array.from(rowsMap.values())
    .filter((r) => isStockUnderlying(r.underlying))
    .map((row) => {
      let gain = 0;
      for (const col of gainCols) gain += row[col];
      row.ganho_aproximado = Math.round((gain - row.taxas) * 100) / 100;
      return row;
    })
    .filter((row) => {
      if (Math.abs(row.ganho_aproximado) > 0.01) return true;
      return gainCols.some((c) => Math.abs(row[c]) > 0.01) || row.taxas > 0.01;
    });

  rows.sort((a, b) => Math.abs(b.ganho_aproximado) - Math.abs(a.ganho_aproximado));

  const totals = emptyRow('TOTAL');
  totals.label = 'Total geral';
  for (const row of rows) {
    for (const col of STOCK_PIVOT_COLUMNS) {
      totals[col] = Math.round((totals[col] + row[col]) * 100) / 100;
    }
  }

  return { from, to, rows, totals };
}

export function enrichStockPivotWithQuotes(
  pivot: StockUnderlyingPivotResult,
  quotesByTicker: Record<string, { lastPrice?: number }>
): StockUnderlyingPivotResult {
  const rows = pivot.rows.map((row) => {
    const q = quotesByTicker[row.underlying];
    const lp = q?.lastPrice;
    return {
      ...row,
      cotacao_atual: lp != null && Number.isFinite(lp) ? Math.round(lp * 10000) / 10000 : row.cotacao_atual,
    };
  });
  return { ...pivot, rows };
}
