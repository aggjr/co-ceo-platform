import type { LedgerEvent } from './CustodyEngine';
import { computePortfolioPerformance, type PortfolioPerformanceResult } from './portfolioPerformance';
import { computeSharpeRatio, dailyReturnsFromPatrimony } from './sharpeRatio';
import { B3_STOCK_PAYMENT_BUSINESS_DAYS, cashSettlementDate } from './settlementCalendar';

type PositionState = {
  ticker: string;
  assetType: string;
  qty: number;
  mark: number;
};

type ScheduledCash = {
  settleOn: string;
  amount: number;
};

export type DailyPatrimonyPoint = {
  date: string;
  patrimonyGross: number;
  /** Lançamentos futuros manuais (extrato BTG). */
  pendingSettlements: number;
  /** Caixa de trades ainda não liquidados (ex.: compra ação D+2). */
  scheduledCashPending: number;
  patrimony: number;
  cash: number;
  positionsValue: number;
  dailyReturn: number | null;
};

export type PatrimonyDailyResult = {
  from: string;
  to: string;
  series: DailyPatrimonyPoint[];
  sharpe: ReturnType<typeof computeSharpeRatio>;
  performance: PortfolioPerformanceResult | null;
  /** Posições abertas no último dia do intervalo (motor MTM). */
  positionSnapshots?: import('./PatrimonyMtmDailyEngine').PositionDailySnapshot[];
  meta: {
    method: 'mtm_replay' | 'mtm_btg_calibrated' | 'mtm_economic';
    note: string;
    stock_cash_settlement_days: number;
  };
};

function isCashAsset(assetType: string, ticker: string): boolean {
  return assetType === 'cash' || ticker.startsWith('CAIXA-');
}

function scheduleCash(
  scheduled: ScheduledCash[],
  tradeDate: string,
  assetType: string,
  transactionType: string,
  amount: number
): void {
  if (!amount || Number.isNaN(amount)) return;
  const settleOn = cashSettlementDate(tradeDate, assetType, transactionType);
  scheduled.push({ settleOn, amount });
}

function applyCashNow(cash: { value: number }, amount: number): void {
  cash.value += amount;
}

function applyScheduledCashForDay(cash: { value: number }, scheduled: ScheduledCash[], date: string): void {
  let i = 0;
  while (i < scheduled.length) {
    if (scheduled[i]!.settleOn === date) {
      cash.value += scheduled[i]!.amount;
      scheduled.splice(i, 1);
    } else {
      i += 1;
    }
  }
}

function applyEntry(
  positions: Map<string, PositionState>,
  cash: { value: number },
  scheduled: ScheduledCash[],
  tradeDate: string,
  e: LedgerEvent
): void {
  const type = String(e.transaction_type);
  const ticker = String(e.asset_ticker).toUpperCase();
  const assetType = String(e.asset_type || 'stock');
  const qty = Number(e.quantity);
  const price = Number(e.unit_price);
  const net = Number(e.total_net_value ?? 0);

  if (isCashAsset(assetType, ticker)) {
    applyCashNow(cash, net);
    return;
  }

  let pos = positions.get(e.asset_id);
  if (!pos) {
    pos = { ticker, assetType, qty: 0, mark: price > 0 ? price : 0 };
    positions.set(e.asset_id, pos);
  }

  if (price > 0) pos.mark = price;

  if (type === 'opening_balance') {
    pos.qty += Math.abs(qty);
    if (price > 0) pos.mark = price;
    return;
  }

  if (['buy', 'put_buy', 'call_buy', 'bonus'].includes(type)) {
    pos.qty += Math.abs(qty);
    scheduleCash(scheduled, tradeDate, assetType, type, net);
    return;
  }

  if (['sell', 'put_sell', 'call_sell', 'option_exercise'].includes(type)) {
    if (['put_sell', 'call_sell'].includes(type)) {
      pos.qty += qty;
    } else {
      pos.qty += qty < 0 ? qty : -Math.abs(qty);
    }
    scheduleCash(scheduled, tradeDate, assetType, type, net);
    return;
  }

  if (['dividend', 'jcp', 'securities_lending', 'cash_yield'].includes(type)) {
    applyCashNow(cash, net);
    return;
  }

  if (type === 'fee' || type === 'penalty_b3') {
    applyCashNow(cash, net);
    return;
  }

  if (type === 'capital_deposit' || type === 'capital_withdrawal') {
    applyCashNow(cash, net);
  }
}

function positionsMarketValue(positions: Map<string, PositionState>): number {
  let total = 0;
  for (const p of positions.values()) {
    if (p.qty === 0) continue;
    total += p.qty * p.mark;
  }
  return total;
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function groupEntriesByDate(entries: LedgerEvent[]): Map<string, LedgerEvent[]> {
  const map = new Map<string, LedgerEvent[]>();
  for (const e of entries) {
    const day = String(e.transaction_date || '').slice(0, 10);
    if (!day) continue;
    const list = map.get(day) || [];
    list.push(e);
    map.set(day, list);
  }
  return map;
}

/**
 * Reconstrói patrimônio dia a dia.
 * - Posição (ação): data do negócio (D0).
 * - Caixa da compra/venda de ação/FII: D+2 úteis na conta.
 */
export function buildDailyPatrimonySeries(
  entries: LedgerEvent[],
  from: string,
  to: string,
  options?: { riskFreeAnnual?: number }
): PatrimonyDailyResult {
  const sorted = [...entries].sort((a, b) => {
    const da = String(a.transaction_date || '');
    const db = String(b.transaction_date || '');
    return da.localeCompare(db);
  });

  const byDay = groupEntriesByDate(sorted);
  const positions = new Map<string, PositionState>();
  const cash = { value: 0 };
  const scheduled: ScheduledCash[] = [];
  let pendingSettlements = 0;

  const calendar = enumerateDates(from, to);
  const rawPoints: Array<{
    date: string;
    patrimonyGross: number;
    pendingSettlements: number;
    scheduledCashPending: number;
    patrimony: number;
    cash: number;
    positionsValue: number;
  }> = [];

  for (const date of calendar) {
    applyScheduledCashForDay(cash, scheduled, date);

    const dayEntries = byDay.get(date) || [];
    for (const e of dayEntries) {
      const type = String(e.transaction_type);
      if (type === 'pending_settlement') {
        pendingSettlements += Number(e.total_net_value ?? 0);
        continue;
      }
      if (e.impacts_managerial_price === false || e.impacts_managerial_price === 0) {
        if (isCashAsset(String(e.asset_type), String(e.asset_ticker))) {
          applyCashNow(cash, Number(e.total_net_value ?? 0));
        }
        continue;
      }
      applyEntry(positions, cash, scheduled, date, e);
    }

    const posVal = positionsMarketValue(positions);
    const gross = Math.round((cash.value + posVal) * 100) / 100;
    const pending = Math.round(pendingSettlements * 100) / 100;
    const patrimony = Math.round((gross + pending) * 100) / 100;
    rawPoints.push({
      date,
      patrimonyGross: gross,
      pendingSettlements: pending,
      scheduledCashPending: Math.round(
        scheduled.reduce((s, x) => s + x.amount, 0) * 100
      ) / 100,
      patrimony,
      cash: Math.round(cash.value * 100) / 100,
      positionsValue: Math.round(posVal * 100) / 100,
    });
  }

  const series: DailyPatrimonyPoint[] = [];
  let lastPatrimony: number | null = null;

  for (const p of rawPoints) {
    let dailyReturn: number | null = null;
    if (lastPatrimony != null && lastPatrimony !== 0) {
      dailyReturn = Math.round(((p.patrimony - lastPatrimony) / lastPatrimony) * 10000) / 10000;
    }
    if (p.patrimonyGross > 0 || p.pendingSettlements !== 0 || lastPatrimony != null) {
      series.push({
        date: p.date,
        patrimonyGross: p.patrimonyGross,
        pendingSettlements: p.pendingSettlements,
        scheduledCashPending: p.scheduledCashPending,
        patrimony: p.patrimony,
        cash: p.cash,
        positionsValue: p.positionsValue,
        dailyReturn,
      });
      lastPatrimony = p.patrimony;
    }
  }

  const performance = computePortfolioPerformance(series, entries, from, to);
  const returnsForSharpe =
    performance?.points
      .map((p) => p.dailyReturnAdjusted)
      .filter((r): r is number => r != null) ?? dailyReturnsFromPatrimony(series);
  const sharpe = computeSharpeRatio(returnsForSharpe, {
    riskFreeAnnual: options?.riskFreeAnnual ?? 0,
  });

  return {
    from,
    to,
    series,
    sharpe,
    performance,
    meta: {
      method: 'mtm_replay',
      stock_cash_settlement_days: B3_STOCK_PAYMENT_BUSINESS_DAYS,
      note:
        'Compra/venda de ação: papel no pregão (D0); pagamento na conta em D+2 úteis. Rentabilidade acumulada ajusta apenas aportes/retiradas (capital_deposit/withdrawal); proventos e operações entram no rendimento.',
    },
  };
}
