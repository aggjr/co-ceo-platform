import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';
import { inferAssetType, inferUnderlyingTicker, isFixedIncomeTicker } from './assetClassifier';

/** Colunas do pivot por ação (underlying). */
export const STOCK_PIVOT_COLUMNS = [
  'ganho_aproximado',
  'venda_call',
  'compra_call',
  'venda_put',
  'compra_put',
  'resultado_custodia',
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
  resultado_custodia: 'Resultado Custódia',
  dividendos: 'Dividendos',
  jcp: 'JCP',
  locacao_acao: 'Locação ação',
  trade: 'Trade',
  day_trade: 'Day trade',
  bonus: 'Bonificação',
  outros_ganhos: 'Outros ganhos',
  taxas: 'Taxas (todas)',
  ganho_aproximado: 'Resultado',
};

export type StockPivotRow = Record<StockPivotColumnKey, number> & {
  underlying: string;
  label: string;
  preco_estrito: number | null;
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

function tradeCashBeforeExpenses(e: LedgerEvent, type: string): number {
  const qty = Math.abs(Number(e.quantity ?? 0));
  const price = Number(e.unit_price ?? 0);
  const gross = qty * price;
  if (['buy', 'call_buy', 'put_buy'].includes(type)) return -gross;
  if (['sell', 'call_sell', 'put_sell', 'option_exercise'].includes(type)) return gross;
  return netCash(e);
}

function underlyingOf(e: LedgerEvent): string {
  const ticker = String(e.asset_ticker || '').toUpperCase();
  const assetType = String(e.asset_type || inferAssetType(ticker));
  if (assetType === 'fixed_income' || isFixedIncomeTicker(ticker)) {
    return ticker;
  }
  const explicit = e.underlying_ticker?.trim();
  if (explicit) return explicit.toUpperCase();
  if (assetType === 'option_call' || assetType === 'option_put') {
    return inferUnderlyingTicker(ticker, explicit);
  }
  return ticker;
}

/** Linha do pivot: ações B3 (PN/ON/FII) e renda fixa (LFT, CDB, Tesouro). */
function isPivotAssetKey(ticker: string): boolean {
  const t = ticker.toUpperCase();
  if (!t || t.startsWith('CAIXA')) return false;
  if (isFixedIncomeTicker(t)) return true;
  return /^[A-Z]{4}(3|4|8|11)$/.test(t);
}

function addToRow(row: StockPivotRow, col: StockPivotColumnKey, amount: number): void {
  row[col] = Math.round((row[col] + amount) * 100) / 100;
}

function signedExpense(value: number): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return 0;
  return -Math.abs(n);
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

    if (type === 'split' && Number(e.quantity) > 0 && s.qty > 0) {
      s.qty = Number(e.quantity);
      return { closedQty, costBasisClosed, wasLong };
    }

    if (type === 'revaluation') {
      const assetType = String(e.asset_type || inferAssetType(String(e.asset_ticker)));
      const isOption = assetType === 'option_call' || assetType === 'option_put';
      const newPrice = Number(e.unit_price ?? 0);
      if (isOption && s.qty > 0 && newPrice <= 0) {
        wasLong = true;
        closedQty = s.qty;
        costBasisClosed = s.totalCost;
        s.qty = 0;
        s.totalCost = 0;
      }
      return { closedQty, costBasisClosed, wasLong };
    }

    // option_exercise num SHORT fecha a posição (o comprador exerceu contra nós);
    // numa posição LONG, o option_exercise é equivalente a vender (exercemos o direito).
    const isExerciseOnShort = type === 'option_exercise' && s.qty < 0;
    const isBuy = ['buy', 'put_buy', 'call_buy', 'opening_balance', 'bonus'].includes(type) || isExerciseOnShort;
    const isSell = ['sell', 'put_sell', 'call_sell', 'option_exercise'].includes(type) && !isExerciseOnShort;

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
    if (!isPivotAssetKey(und)) continue;

    const row = getRow(und);
    const type = String(e.transaction_type);
    const assetType = String(e.asset_type || inferAssetType(String(e.asset_ticker)));
    const net = netCash(e);
    const tradeCash = tradeCashBeforeExpenses(e, type);
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
      case 'cash_yield':
        addToRow(row, 'outros_ganhos', net);
        break;
      case 'fee':
      case 'penalty_b3':
        addToRow(row, 'taxas', signedExpense(net));
        break;
      case 'amortization':
        addToRow(row, 'outros_ganhos', net);
        break;
      case 'revaluation':
        if (assetType === 'option_call' || assetType === 'option_put') {
          if (closedQty > 0 && wasLong) {
            const colLong = assetType === 'option_call' ? 'compra_call' : 'compra_put';
            addToRow(row, colLong, net - costBasisClosed);
          } else {
            addToRow(row, 'outros_ganhos', net);
          }
        } else {
          addToRow(row, 'outros_ganhos', net);
        }
        break;
      case 'cost_adjustment':
        addToRow(row, 'taxas', signedExpense(net !== 0 ? net : Number(e.unit_price ?? 0)));
        break;
      case 'extract_divergence':
        addToRow(row, 'outros_ganhos', net);
        break;
      case 'put_sell':
      case 'put_buy':
      case 'call_sell':
      case 'call_buy':
      case 'sell':
      case 'buy':
      case 'option_exercise': {
        if (assetType === 'stock' || assetType === 'fii' || assetType === 'fixed_income') {
          if (type === 'buy') {
            if (closedQty > 0 && !wasLong) {
               const cashOfClosed = qty > 0 ? tradeCash * (closedQty / qty) : tradeCash;
               const pnl = cashOfClosed + costBasisClosed;
               addToRow(row, 'trade', pnl);
            }
            recordSameDayBuy(und, day, qty);
          } else if (type === 'sell' || type === 'option_exercise') {
            const dtQty = consumeSameDayBuy(und, day, qty);
            const swingQty = Math.max(0, qty - dtQty);
            const cashPerShare = qty > 0 ? tradeCash / qty : 0;
            const costPerShare = closedQty > 0 ? costBasisClosed / closedQty : 0;

            if (dtQty > 0) {
              const pnlDt = (cashPerShare * dtQty) - (costPerShare * dtQty);
              addToRow(row, 'day_trade', pnlDt);
            }
            if (swingQty > 0) {
              const pnlSw = (cashPerShare * swingQty) - (costPerShare * swingQty);
              addToRow(row, 'trade', pnlSw);
            }
            if (dtQty === 0 && swingQty === 0 && qty > 0) {
              addToRow(row, 'trade', tradeCash - costBasisClosed);
            }
          }
        } else if (assetType === 'option_put' || assetType === 'option_call') {
          const isCall = assetType === 'option_call';
          const colShort = isCall ? 'venda_call' : 'venda_put';
          const colLong  = isCall ? 'compra_call' : 'compra_put';

          if (['call_sell', 'put_sell'].includes(type)) {
            if (closedQty > 0 && wasLong) {
              // Fechando posição LONG (venda de opção comprada): P&L vs custo
              const cashOfClosed = qty > 0 ? tradeCash * (closedQty / qty) : tradeCash;
              addToRow(row, colLong, cashOfClosed - costBasisClosed);
            } else if (closedQty === 0) {
              // Abrindo posição SHORT: prêmio recebido vai para venda_call/venda_put
              addToRow(row, colShort, tradeCash);
            }
          } else if (['call_buy', 'put_buy'].includes(type)) {
            if (closedQty > 0 && !wasLong) {
              // Recompra de SHORT (closing short): subtrai custo de venda_call/venda_put
              // tradeCash é negativo (pagamos para fechar); reduz o ganho acumulado
              const cashOfClosed = qty > 0 ? tradeCash * (closedQty / qty) : tradeCash;
              addToRow(row, colShort, cashOfClosed);
            }
            // Abertura de LONG: custo de capital, não entra nas colunas de resultado
          } else if (type === 'option_exercise') {
            if (closedQty > 0 && !wasLong) {
              // Exercício de SHORT (comprador exerceu contra nós): opção vai a zero/intrínseco.
              // Se houver fluxo de caixa na opção em si (ex: opção exercida pelo valor intrínseco),
              // ajusta venda_call/venda_put; caso contrário (tradeCash = 0) mantém o prêmio intacto.
              if (tradeCash !== 0) {
                const cashOfClosed = qty > 0 ? tradeCash * (closedQty / qty) : tradeCash;
                addToRow(row, colShort, cashOfClosed);
              }
            } else if (closedQty > 0 && wasLong) {
              // Exercício de LONG (exercemos nosso direito): P&L vs custo
              const cashOfClosed = qty > 0 ? tradeCash * (closedQty / qty) : tradeCash;
              addToRow(row, colLong, cashOfClosed - costBasisClosed);
            }
          }
        }
        break;
      }
      default:
        if (net !== 0 && !['capital_deposit', 'capital_withdrawal', 'pending_settlement', 'opening_balance'].includes(type)) {
          addToRow(row, 'outros_ganhos', net);
        }
        break;
    }

    const exp = expenseAmount(e);
    if (exp > 0 && type !== 'fee' && type !== 'cost_adjustment') {
      addToRow(row, 'taxas', -exp);
    }
  }

  const custody = rebuildCustodyFromLedger(entries);
  for (const pos of custody.assets) {
    const ticker = String(pos.underlying || pos.ticker || '').toUpperCase();
    if (!isPivotAssetKey(ticker)) continue;
    const row = getRow(ticker);
    if (
      (pos.assetType === 'stock' ||
        pos.assetType === 'fii' ||
        pos.assetType === 'etf' ||
        pos.assetType === 'bdr' ||
        pos.assetType === 'fixed_income' ||
        isFixedIncomeTicker(ticker)) &&
      pos.quantity > 0 &&
      pos.avgPrice > 0
    ) {
      row.preco_estrito = Math.round(pos.avgPrice * 10000) / 10000;
    }
    
    // Resultado de custódia: apenas prêmio de opções vendidas ainda abertas.
    // Não entra custo da ação comprada (isso é capital investido, não ganho/perda).
    if (
      (pos.assetType === 'option_call' || pos.assetType === 'option_put') &&
      pos.quantity < 0 &&
      pos.avgPrice > 0
    ) {
      const openPremium = Math.abs(pos.quantity) * pos.avgPrice;
      addToRow(row, 'resultado_custodia', openPremium);
    }
  }

  const gainCols: StockPivotColumnKey[] = [
    'venda_call',
    'compra_call',
    'venda_put',
    'compra_put',
    // resultado_custodia exclui dos gainCols: prêmio de opções SHORT abertas já está
    // em venda_call/venda_put no momento da abertura. resultado_custodia permanece como
    // coluna informativa (quanto de prêmio ainda está "em aberto" no período).
    'dividendos',
    'jcp',
    'locacao_acao',
    'trade',
    'day_trade',
    'bonus',
    'outros_ganhos',
  ];

  const rows = Array.from(rowsMap.values())
    .filter((r) => isPivotAssetKey(r.underlying))
    .map((row) => {
      let gain = 0;
      for (const col of gainCols) gain += row[col];
      row.ganho_aproximado = Math.round((gain + row.taxas) * 100) / 100;
      return row;
    })
    .filter((row) => {
      if (Math.abs(row.ganho_aproximado) > 0.01) return true;
      return gainCols.some((c) => Math.abs(row[c]) > 0.01) || Math.abs(row.taxas) > 0.01;
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
    const quote = quotesByTicker[String(row.underlying || '').toUpperCase()]?.lastPrice;
    const cotacao =
      quote != null && Number.isFinite(quote) && quote > 0
        ? Math.round(quote * 10000) / 10000
        : row.cotacao_atual ?? null;
    return { ...row, cotacao_atual: cotacao };
  });
  return {
    ...pivot,
    rows,
    totals: { ...pivot.totals, preco_estrito: null, cotacao_atual: null },
  };
}
