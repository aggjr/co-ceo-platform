import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType } from './assetClassifier';
import type { DailyPatrimonyPoint, PatrimonyDailyResult } from './PatrimonyDailyEngine';
import {
  computePortfolioPerformance,
  computeTwrFromMonthEndAnchors,
} from './portfolioPerformance';
import { computeSharpeRatio, dailyReturnsFromPatrimony } from './sharpeRatio';
import { inferOptionExpiryDate } from './optionExpiry';
import {
  interpolatePatrimonyTarget,
  loadPatrimonyAnchors,
  type PatrimonyAnchorFile,
} from './patrimonyAnchors';

type DayPosition = {
  assetId: string;
  ticker: string;
  assetType: string;
  qty: number;
  /** Prêmio médio (opções) ou PM (ações). */
  unitCost: number;
  expiry: string | null;
  firstSeen: string;
};

export type StockQuoteMap = Record<string, number>;

export type PatrimonyMtmOptions = {
  riskFreeAnnual?: number;
  anchors?: PatrimonyAnchorFile;
  /** Cotações de mercado para o dia atual (fallback quando quoteForDate não existe). */
  stockQuotes?: StockQuoteMap;
  fixedIncomeTotal?: number;
  /** Se false, patrimônio econômico real (sem ajuste às âncoras BTG). Usado na gravação diária. */
  calibrateToAnchors?: boolean;
  /**
   * Cotação de fechamento por (ticker, date). Quando presente tem prioridade sobre stockQuotes.
   * Alimentado por market_quotes_daily para séries históricas (Fase B).
   * Retorne undefined para que o engine recorra ao stockQuotes ou ao custo do livro.
   */
  quoteForDate?: (ticker: string, date: string) => number | undefined;
};

export type PositionDailySnapshot = {
  assetId: string;
  ticker: string;
  assetType: string;
  quantity: number;
  closingPrice: number;
  unitCost: number;
  marketValue: number;
  managerialValue: number;
};

function isCash(assetType: string, ticker: string): boolean {
  return assetType === 'cash' || ticker.startsWith('CAIXA-');
}

function isOptionType(assetType: string): boolean {
  return assetType === 'option_call' || assetType === 'option_put';
}

/** Ajustes contábeis de caixa (reconciliação Necton) — não entram no patrimônio econômico diário. */
function isPatrimonyCashAdjustment(e: LedgerEvent): boolean {
  const ref = String(e.broker_note_ref || '');
  return ref.includes('CASH-RECON') || ref.includes('CLEAR-BTG-PENDING') || ref.includes('NECTON-SNAPSHOT');
}

function isFixedIncome(assetType: string, ticker: string): boolean {
  return (
    assetType === 'fixed_income' ||
    ticker.startsWith('TESOURO-') ||
    ticker.startsWith('CDB-') ||
    ticker.startsWith('TD-') ||
    ticker.startsWith('LFT-')
  );
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

function groupByDate(entries: LedgerEvent[]): Map<string, LedgerEvent[]> {
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

function applyQty(pos: DayPosition, type: string, qty: number): void {
  if (type === 'opening_balance' || type === 'buy' || type === 'bonus') {
    pos.qty += Math.abs(qty);
    return;
  }
  if (type === 'sell' || type === 'option_exercise') {
    pos.qty -= Math.abs(qty);
    return;
  }
  if (type === 'put_buy' || type === 'call_buy') {
    pos.qty += qty;
    return;
  }
  if (type === 'put_sell' || type === 'call_sell') {
    pos.qty += qty;
  }
}

function optionTimeMark(
  pos: DayPosition,
  date: string
): number {
  if (!pos.expiry || pos.qty === 0) return 0;
  if (date >= pos.expiry) return 0;
  const start = pos.firstSeen;
  const t0 = new Date(`${start}T12:00:00Z`).getTime();
  const t1 = new Date(`${pos.expiry}T12:00:00Z`).getTime();
  const td = new Date(`${date}T12:00:00Z`).getTime();
  if (t1 <= t0) return pos.qty * pos.unitCost;
  const w = Math.max(0, Math.min(1, (t1 - td) / (t1 - t0)));
  return pos.qty * pos.unitCost * w;
}

/**
 * Patrimônio diário 2026: ações e RF pelo livro + cotações;
 * opções com decaimento linear até vencimento (zero no expiry);
 * calibração residual nas opções para aproximar âncoras mensais BTG.
 */
export function buildDailyPatrimonyMtmSeries(
  entries: LedgerEvent[],
  from: string,
  to: string,
  options?: PatrimonyMtmOptions
): PatrimonyDailyResult {
  const anchors = options?.anchors ?? loadPatrimonyAnchors();
  const calibrate = options?.calibrateToAnchors === true;
  const fixedIncome =
    options?.fixedIncomeTotal ?? Number(anchors.fixed_income_total ?? 0);
  const stockQuotes = options?.stockQuotes ?? {};
  const quoteForDate = options?.quoteForDate;

  const sorted = [...entries].sort((a, b) =>
    String(a.transaction_date).localeCompare(String(b.transaction_date))
  );
  const byDay = groupByDate(sorted);
  const positions = new Map<string, DayPosition>();
  let cash = 0;
  let pendingSettlements = 0;

  const calendar = enumerateDates(from, to);
  const rawPoints: Array<{
    date: string;
    stocksValue: number;
    optionsStructural: number;
    optionsValue: number;
    cash: number;
    fixedIncome: number;
    pendingSettlements: number;
    patrimonyGross: number;
    patrimony: number;
    target: number;
  }> = [];

  for (const date of calendar) {
    for (const e of byDay.get(date) || []) {
      const type = String(e.transaction_type);
      const ticker = String(e.asset_ticker).toUpperCase();
      const assetType = String(e.asset_type || inferAssetType(ticker));

      if (type === 'pending_settlement') {
        pendingSettlements += Number(e.total_net_value ?? 0);
        continue;
      }

      if (isCash(assetType, ticker)) {
        if (isPatrimonyCashAdjustment(e)) continue;
        const net = Number(e.total_net_value ?? 0);
        if (net !== 0) cash += net;
        else if (type === 'opening_balance') {
          cash += Math.abs(Number(e.quantity)) * Number(e.unit_price || 1);
        }
        continue;
      }

      if (isFixedIncome(assetType, ticker)) continue;

      let pos = positions.get(e.asset_id);
      if (!pos) {
        const expiry = isOptionType(assetType)
          ? inferOptionExpiryDate(ticker, Number(date.slice(0, 4)))
          : null;
        pos = {
          assetId: e.asset_id,
          ticker,
          assetType,
          qty: 0,
          unitCost: 0,
          expiry,
          firstSeen: date,
        };
        positions.set(e.asset_id, pos);
      }

      const price = Number(e.unit_price);
      if (price > 0) pos.unitCost = price;

      if (type === 'opening_balance') {
        pos.qty = Math.abs(Number(e.quantity));
        continue;
      }

      applyQty(pos, type, Number(e.quantity));
    }

    let stocksValue = 0;
    let optionsFromMarket = 0;
    let optionsStructural = 0;

    for (const p of positions.values()) {
      if (Math.abs(p.qty) < 0.0001) continue;
      // Prioridade: market_quotes_daily (por dia) > stockQuotes (atual) > custo/decaimento
      const dailyMark = quoteForDate?.(p.ticker, date);
      if (isOptionType(p.assetType)) {
        const mark = dailyMark ?? stockQuotes[p.ticker];
        if (mark != null && Number.isFinite(mark)) {
          optionsFromMarket += p.qty * mark;
        } else {
          optionsStructural += optionTimeMark(p, date);
        }
        continue;
      }
      if (p.assetType === 'stock' || p.assetType === 'fii') {
        const mark = dailyMark ?? stockQuotes[p.ticker] ?? p.unitCost;
        stocksValue += p.qty * mark;
      }
    }

    const base = stocksValue + cash + fixedIncome;
    const target = calibrate ? interpolatePatrimonyTarget(date, anchors) : 0;
    const pending = Math.round(pendingSettlements * 100) / 100;
    let optionsValue: number;
    if (!calibrate) {
      optionsValue = Math.round((optionsFromMarket + optionsStructural) * 100) / 100;
    } else if (optionsStructural === 0 && Object.keys(stockQuotes).length > 0) {
      optionsValue = Math.round(optionsFromMarket * 100) / 100;
    } else {
      const residual = Math.round((target - base - pending - optionsFromMarket) * 100) / 100;
      optionsValue = Math.round((optionsFromMarket + residual) * 100) / 100;
    }
    let patrimonyGross = Math.round((base + optionsValue) * 100) / 100;
    let patrimony = Math.round((patrimonyGross + pending) * 100) / 100;
    if (calibrate && Math.abs(patrimony - target) > 1) {
      optionsValue = Math.round((target - base - pending) * 100) / 100;
      patrimonyGross = Math.round((base + optionsValue) * 100) / 100;
      patrimony = Math.round((patrimonyGross + pending) * 100) / 100;
    }

    rawPoints.push({
      date,
      stocksValue: Math.round(stocksValue * 100) / 100,
      optionsStructural: Math.round(optionsStructural * 100) / 100,
      optionsValue,
      cash: Math.round(cash * 100) / 100,
      fixedIncome,
      pendingSettlements: pending,
      patrimonyGross,
      patrimony,
      target: calibrate ? Math.round(target * 100) / 100 : patrimony,
    });
  }

  const series: DailyPatrimonyPoint[] = [];
  let lastPatrimony: number | null = null;

  for (const p of rawPoints) {
    let dailyReturn: number | null = null;
    if (lastPatrimony != null && lastPatrimony !== 0) {
      dailyReturn =
        Math.round(((p.patrimony - lastPatrimony) / lastPatrimony) * 10000) / 10000;
    }
    series.push({
      date: p.date,
      patrimonyGross: p.patrimonyGross,
      pendingSettlements: p.pendingSettlements,
      scheduledCashPending: 0,
      patrimony: p.patrimony,
      cash: p.cash,
      positionsValue: Math.round((p.stocksValue + p.optionsValue) * 100) / 100,
      dailyReturn,
    });
    lastPatrimony = p.patrimony;
  }

  const performanceDaily = computePortfolioPerformance(series, entries, from, to);
  const monthLinked = computeTwrFromMonthEndAnchors(anchors, entries, from, to);
  const performance = performanceDaily
    ? {
        ...performanceDaily,
        /** TWR diário (série interpolada) — apenas diagnóstico. */
        periodReturnTwrDaily: performanceDaily.periodReturnTwr,
        monthAnchorTwr: monthLinked?.periodReturnTwr,
        monthAnchorBreakdown: monthLinked?.months,
        periodReturnTwr: performanceDaily.periodReturnTwr,
        periodGainBrl: monthLinked
          ? Math.round(
              ((monthLinked.months[monthLinked.months.length - 1]?.endPatrimony ?? performanceDaily.endPatrimony) -
                (monthLinked.months[0]?.startPatrimony ?? performanceDaily.startPatrimony) -
                performanceDaily.totalExternalFlows) *
                100
            ) / 100
          : performanceDaily.periodGainBrl,
      }
    : null;
  const returnsForSharpe =
    performance?.points
      .map((p) => p.dailyReturnAdjusted)
      .filter((r): r is number => r != null) ?? dailyReturnsFromPatrimony(series);
  const sharpe = computeSharpeRatio(returnsForSharpe, {
    riskFreeAnnual: options?.riskFreeAnnual ?? 0,
  });

  const positionSnapshots = snapshotOpenPositions(positions, stockQuotes, to, quoteForDate);

  return {
    from,
    to,
    series,
    sharpe,
    performance,
    positionSnapshots,
    meta: {
      method: calibrate ? 'mtm_btg_calibrated' : 'mtm_economic',
      stock_cash_settlement_days: 0,
      note: calibrate
        ? 'Patrimônio econômico: posições × cotação atual + caixa (sem ajustes CASH-RECON). ' +
          'TWR diário: só capital_deposit/withdrawal como fluxo externo. ' +
          'Cotações históricas diárias ainda não importadas — rentab. pode divergir do BTG.'
        : 'Patrimônio econômico do dia (cotações do fechamento, sem calibração BTG).',
    },
  };
}

function snapshotOpenPositions(
  positions: Map<string, DayPosition>,
  stockQuotes: StockQuoteMap,
  asOf: string,
  quoteForDate?: (ticker: string, date: string) => number | undefined
): PositionDailySnapshot[] {
  const out: PositionDailySnapshot[] = [];
  for (const p of positions.values()) {
    if (Math.abs(p.qty) < 0.0001) continue;
    if (isCash(p.assetType, p.ticker) || isFixedIncome(p.assetType, p.ticker)) continue;
    let closing = quoteForDate?.(p.ticker, asOf) ?? stockQuotes[p.ticker];
    if (closing == null || !Number.isFinite(closing)) {
      closing = isOptionType(p.assetType) ? optionTimeMark(p, asOf) / Math.max(Math.abs(p.qty), 1) : p.unitCost;
    }
    const marketValue = Math.round(p.qty * closing * 100) / 100;
    const managerialValue = Math.round(p.qty * p.unitCost * 100) / 100;
    out.push({
      assetId: p.assetId,
      ticker: p.ticker,
      assetType: p.assetType,
      quantity: Math.round(p.qty * 10000) / 10000,
      closingPrice: Math.round(closing * 10000) / 10000,
      unitCost: Math.round(p.unitCost * 10000) / 10000,
      marketValue,
      managerialValue,
    });
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
}
