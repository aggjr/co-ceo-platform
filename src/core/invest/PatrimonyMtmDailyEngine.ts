import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType } from './assetClassifier';
import { inferUnderlyingTicker } from './assetClassifier';
import type { DailyPatrimonyPoint, PatrimonyDailyResult } from './PatrimonyDailyEngine';
import {
  computePortfolioPerformance,
  computeTwrFromMonthEndAnchors,
  aggregateExternalFlowsByDate,
} from './portfolioPerformance';
import { buildCashInTransitSummary } from './cashInTransit';
import { computeSharpeRatio, dailyReturnsFromPatrimony } from './sharpeRatio';
import { inferOptionExpiryDate } from './optionExpiry';
import { inferOptionStrikeFromTicker } from './optionExpiry';
import { blackScholesOptionPrice, type OptionSide } from './optionBlackScholes';
import {
  interpolatePatrimonyTarget,
  loadPatrimonyAnchors,
  type PatrimonyAnchorFile,
} from './patrimonyAnchors';
import {
  contributesToMarketPricedPatrimony,
  currencyFor,
  isFixedIncomeCategory,
  isOptionCategory,
  type AssetValuationSnapshot,
} from './valuation/AssetValuationContext';

type DayPosition = {
  assetId: string;
  ticker: string;
  assetType: string;
  underlyingTicker: string | null;
  optionType: OptionSide | null;
  strike: number | null;
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
  /** Fallback legado para bases sem posicao RF detalhada; a fonte primaria eh qty x cotacao no livro. */
  fixedIncomeTotal?: number;
  /** Quando true, compara patrimonio economico vs ancora BTG em meta (sem ajustar valor). */
  compareAnchor?: boolean;
  /**
   * Cotação de fechamento por (ticker, date). Quando presente tem prioridade sobre stockQuotes.
   * Alimentado por market_quotes_daily para séries históricas (Fase B).
   * Retorne undefined para que o engine recorra ao stockQuotes ou ao custo do livro.
   */
  quoteForDate?: (ticker: string, date: string) => number | undefined;
  valuationContext?: AssetValuationSnapshot;
  fxRateForDate?: (fromCurrency: string, toCurrency: string, date: string) => number | undefined;
  optionContractForTicker?: (ticker: string) => {
    underlyingTicker?: string | null;
    optionType?: 'CALL' | 'PUT' | 'call' | 'put' | null;
    strikePrice?: number | null;
    expirationDate?: string | null;
  } | undefined;
  optionVolatilityAnnual?: number;
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
  priceSource:
    | 'market'
    | 'previous_market'
    | 'black_scholes'
    | 'estimated_decay'
    | 'expired_zero'
    | 'cost';
};

function isCash(
  assetType: string,
  ticker: string,
  valuationContext?: AssetValuationSnapshot
): boolean {
  void valuationContext;
  return assetType === 'cash' || ticker.startsWith('CAIXA-');
}

function isOptionType(
  assetType: string,
  valuationContext?: AssetValuationSnapshot
): boolean {
  return isOptionCategory(valuationContext, assetType);
}

/** Ajustes contábeis de caixa (reconciliação Necton) — não entram no patrimônio econômico diário. */
function isPatrimonyCashAdjustment(e: LedgerEvent): boolean {
  const ref = String(e.broker_note_ref || '');
  return ref.includes('CASH-RECON') || ref.includes('CLEAR-BTG-PENDING') || ref.includes('NECTON-SNAPSHOT');
}

function isFixedIncome(
  assetType: string,
  ticker: string,
  valuationContext?: AssetValuationSnapshot
): boolean {
  void ticker;
  return isFixedIncomeCategory(valuationContext, assetType);
}

function valueInBaseCurrency(
  value: number,
  assetType: string,
  date: string,
  options?: PatrimonyMtmOptions
): number {
  const currency = currencyFor(options?.valuationContext, assetType);
  if (currency === 'BRL') return value;
  const fx = options?.fxRateForDate?.(currency, 'BRL', date);
  return value * (fx && Number.isFinite(fx) && fx > 0 ? fx : 1);
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

function roundMoney(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
}

function parsePositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeOptionSide(value: unknown, assetType: string): OptionSide | null {
  const side = String(value ?? '').trim().toLowerCase();
  if (side === 'call') return 'call';
  if (side === 'put') return 'put';
  const type = assetType.toLowerCase();
  if (type === 'option_call') return 'call';
  if (type === 'option_put') return 'put';
  return null;
}

function optionContractFromEvent(
  e: LedgerEvent,
  assetType: string,
  options?: PatrimonyMtmOptions
): {
  underlyingTicker: string | null;
  optionType: OptionSide | null;
  strike: number | null;
  expiration: string | null;
} {
  const ticker = String(e.asset_ticker || '').toUpperCase();
  const external = options?.optionContractForTicker?.(ticker);
  const meta = e.metadata ?? {};
  const optionType = normalizeOptionSide(
    external?.optionType ?? meta.option_type ?? meta.optionSide,
    assetType
  );
  const strike =
    parsePositiveNumber(external?.strikePrice) ??
    parsePositiveNumber(meta.option_strike) ??
    parsePositiveNumber(meta.strike_price) ??
    inferOptionStrikeFromTicker(ticker);
  const expiration =
    external?.expirationDate?.slice(0, 10) ??
    (typeof meta.option_expiration === 'string' ? meta.option_expiration.slice(0, 10) : null) ??
    (typeof meta.expiration_date === 'string' ? meta.expiration_date.slice(0, 10) : null) ??
    inferOptionExpiryDate(ticker, Number(String(e.transaction_date || '').slice(0, 4)));
  const underlyingTicker = String(
    external?.underlyingTicker ??
    meta.underlying_ticker ??
    e.underlying_ticker ??
    inferUnderlyingTicker(ticker)
  ).toUpperCase();

  return {
    underlyingTicker: underlyingTicker || null,
    optionType,
    strike,
    expiration,
  };
}

function resolveUnderlyingMark(
  ticker: string | null,
  date: string,
  quoteForDate: PatrimonyMtmOptions['quoteForDate'],
  lastKnownPrices: Map<string, number>
): number | null {
  if (!ticker) return null;
  const key = ticker.toUpperCase();
  const daily = quoteForDate?.(key, date);
  if (daily != null && Number.isFinite(daily) && daily > 0) {
    lastKnownPrices.set(key, daily);
    return daily;
  }
  return lastKnownPrices.get(key) ?? null;
}

function blackScholesMark(
  p: DayPosition,
  date: string,
  quoteForDate: PatrimonyMtmOptions['quoteForDate'],
  lastKnownPrices: Map<string, number>,
  options?: PatrimonyMtmOptions
): number | null {
  if (!p.optionType || !p.strike || !p.expiry) return null;
  const spot = resolveUnderlyingMark(p.underlyingTicker, date, quoteForDate, lastKnownPrices);
  if (spot == null) return null;
  return blackScholesOptionPrice({
    side: p.optionType,
    spot,
    strike: p.strike,
    valuationDate: date,
    expirationDate: p.expiry,
    riskFreeAnnual: options?.riskFreeAnnual,
    volatilityAnnual: options?.optionVolatilityAnnual,
  });
}

function resolvePositionMarkWithSource(
  p: DayPosition,
  date: string,
  quoteForDate: PatrimonyMtmOptions['quoteForDate'],
  stockQuotes: StockQuoteMap,
  lastKnownPrices: Map<string, number>,
  options?: PatrimonyMtmOptions,
  valuationContext?: PatrimonyMtmOptions['valuationContext']
): { price: number; source: PositionDailySnapshot['priceSource'] } | null {
  const historicalMode = quoteForDate != null;
  const daily = quoteForDate?.(p.ticker, date);
  if (daily != null && Number.isFinite(daily) && daily > 0) {
    lastKnownPrices.set(p.ticker, daily);
    return { price: daily, source: 'market' };
  }
  if (isOptionType(p.assetType, valuationContext) && p.expiry && date >= p.expiry) {
    return { price: 0, source: 'expired_zero' };
  }
  const lastKnown = lastKnownPrices.get(p.ticker);
  if (lastKnown != null) return { price: lastKnown, source: 'previous_market' };

  if (!historicalMode) {
    const cur = stockQuotes[p.ticker];
    if (cur != null && Number.isFinite(cur) && cur > 0) {
      lastKnownPrices.set(p.ticker, cur);
      return { price: cur, source: 'market' };
    }
  }
  if (isOptionType(p.assetType, valuationContext)) {
    const bs = blackScholesMark(p, date, quoteForDate, lastKnownPrices, options);
    if (bs != null) return { price: bs, source: 'black_scholes' };
    return null;
  }
  if (p.unitCost > 0) return { price: p.unitCost, source: 'cost' };
  return null;
}

function resolvePositionMark(
  p: DayPosition,
  date: string,
  quoteForDate: PatrimonyMtmOptions['quoteForDate'],
  stockQuotes: StockQuoteMap,
  lastKnownPrices: Map<string, number>,
  options?: PatrimonyMtmOptions,
  valuationContext?: PatrimonyMtmOptions['valuationContext']
): number | undefined {
  return resolvePositionMarkWithSource(
    p,
    date,
    quoteForDate,
    stockQuotes,
    lastKnownPrices,
    options,
    valuationContext
  )?.price;
}

function ledgerThroughDate(entries: LedgerEvent[], date: string): LedgerEvent[] {
  return entries.filter((e) => String(e.transaction_date || '').slice(0, 10) <= date);
}

function entriesForEconomicCash(entries: LedgerEvent[]): LedgerEvent[] {
  return entries.filter((e) => {
    const ticker = String(e.asset_ticker || '').toUpperCase();
    const assetType = String(e.asset_type || '');
    if (isCash(assetType, ticker) && isPatrimonyCashAdjustment(e)) return false;
    return true;
  });
}

function economicCashAtDate(
  entries: LedgerEvent[],
  date: string
): { cash: number; scheduledCashPending: number } {
  const slice = entriesForEconomicCash(ledgerThroughDate(entries, date));
  const summary = buildCashInTransitSummary(slice, date);
  return {
    cash: summary.settledCashBalance,
    scheduledCashPending: summary.inTransitNet,
  };
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
 * Patrimonio diario economico: acoes e RF pelo livro + cotacoes;
 * opcoes com decaimento linear ate vencimento (zero no expiry).
 * Divergencia vs ancora BTG e exposta em meta — nunca ajusta patrimonio gravado.
 */
export function buildDailyPatrimonyMtmSeries(
  entries: LedgerEvent[],
  from: string,
  to: string,
  options?: PatrimonyMtmOptions
): PatrimonyDailyResult {
  const anchors = options?.anchors ?? loadPatrimonyAnchors();
  const compareAnchor = options?.compareAnchor === true;
  const fixedIncome =
    options?.fixedIncomeTotal ?? Number(anchors.fixed_income_total ?? 0);
  const stockQuotes = options?.stockQuotes ?? {};
  const quoteForDate = options?.quoteForDate;
  const valuationContext = options?.valuationContext;

  const sorted = [...entries].sort((a, b) =>
    String(a.transaction_date).localeCompare(String(b.transaction_date)) ||
    (String(a.transaction_type) === 'revaluation' && String(b.transaction_type) !== 'revaluation'
      ? 1
      : String(a.transaction_type) !== 'revaluation' && String(b.transaction_type) === 'revaluation'
        ? -1
        : String(a.id ?? '').localeCompare(String(b.id ?? '')))
  );
  const byDay = groupByDate(sorted);
  const flowsByDate = aggregateExternalFlowsByDate(entries, from, to);
  const positions = new Map<string, DayPosition>();
  const lastKnownPrices = new Map<string, number>();
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
    scheduledCashPending: number;
    patrimonyGross: number;
    patrimony: number;
    target: number;
    patrimonyAnchorDivergence: number;
  }> = [];

  const applyPortfolioEvent = (e: LedgerEvent, date: string): void => {
    const type = String(e.transaction_type);
    const ticker = String(e.asset_ticker).toUpperCase();
    const assetType = String(e.asset_type || inferAssetType(ticker));

    if (type === 'pending_settlement') {
      pendingSettlements += Number(e.total_net_value ?? 0);
      return;
    }

    if (isCash(assetType, ticker, valuationContext)) {
      return;
    }

    if (e.impacts_managerial_price === false || e.impacts_managerial_price === 0) {
      return;
    }

    let pos = positions.get(e.asset_id);
    if (!pos) {
      const contract = isOptionType(assetType, valuationContext)
        ? optionContractFromEvent(e, assetType, options)
        : null;
      pos = {
        assetId: e.asset_id,
        ticker,
        assetType,
        underlyingTicker: contract?.underlyingTicker ?? null,
        optionType: contract?.optionType ?? null,
        strike: contract?.strike ?? null,
        qty: 0,
        unitCost: 0,
        expiry: contract?.expiration ?? null,
        firstSeen: date,
      };
      positions.set(e.asset_id, pos);
    } else if (isOptionType(assetType, valuationContext) && (!pos.strike || !pos.expiry || !pos.underlyingTicker)) {
      const contract = optionContractFromEvent(e, assetType, options);
      pos.underlyingTicker = pos.underlyingTicker ?? contract.underlyingTicker;
      pos.optionType = pos.optionType ?? contract.optionType;
      pos.strike = pos.strike ?? contract.strike;
      pos.expiry = pos.expiry ?? contract.expiration;
    }

    if (type === 'cost_adjustment') {
      const amount = Math.abs(Number(e.total_net_value ?? e.unit_price ?? 0));
      const absQty = Math.abs(pos.qty);
      if (absQty > 0 && amount > 0) {
        pos.unitCost = (pos.unitCost * absQty + amount) / absQty;
      }
      return;
    }

    const price = Number(e.unit_price);
    if (price > 0) pos.unitCost = price;

    if (type === 'opening_balance') {
      const openingQty = Number(e.quantity);
      pos.qty = isOptionType(assetType, valuationContext)
        ? openingQty
        : Math.abs(openingQty);
      return;
    }

    applyQty(pos, type, Number(e.quantity));
  };

  for (const e of sorted) {
    const day = String(e.transaction_date || '').slice(0, 10);
    if (!day || day >= from) continue;
    applyPortfolioEvent(e, day);
  }

  for (const date of calendar) {
    for (const e of byDay.get(date) || []) {
      applyPortfolioEvent(e, date);
    }

    const { cash, scheduledCashPending } = economicCashAtDate(sorted, date);

    let stocksValue = 0;
    let optionsFromMarket = 0;
    let optionsStructural = 0;
    let fixedIncomeDynamic = 0;
    let hasOpenFixedIncome = false;

    for (const p of positions.values()) {
      if (Math.abs(p.qty) < 0.0001) continue;

      const dailyMark = resolvePositionMark(
        p,
        date,
        quoteForDate,
        stockQuotes,
        lastKnownPrices,
        options,
        valuationContext
      );
      if (isFixedIncome(p.assetType, p.ticker, valuationContext)) {
        hasOpenFixedIncome = true;
        fixedIncomeDynamic += valueInBaseCurrency(
          p.qty * (dailyMark ?? p.unitCost),
          p.assetType,
          date,
          options
        );
        continue;
      }

      if (isOptionType(p.assetType, valuationContext)) {
        if (dailyMark != null) {
          optionsFromMarket += valueInBaseCurrency(p.qty * dailyMark, p.assetType, date, options);
        } else {
          optionsStructural += valueInBaseCurrency(optionTimeMark(p, date), p.assetType, date, options);
        }
        continue;
      }
      if (contributesToMarketPricedPatrimony(valuationContext, p.assetType, p.ticker)) {
        const mark = dailyMark ?? 0;
        stocksValue += valueInBaseCurrency(p.qty * mark, p.assetType, date, options);
      }
    }

    const currentFixedIncome = hasOpenFixedIncome ? fixedIncomeDynamic : fixedIncome;
    const base = stocksValue + cash + currentFixedIncome;
    const pending = Math.round(scheduledCashPending * 100) / 100;
    const lastAnchorDate = anchors.month_ends.length > 0
      ? anchors.month_ends[anchors.month_ends.length - 1]!.date
      : '';
    const shouldCompareAnchor = compareAnchor && date <= lastAnchorDate;
    const anchorTarget = shouldCompareAnchor
      ? interpolatePatrimonyTarget(date, anchors, flowsByDate)
      : 0;

    const optionsValue = Math.round((optionsFromMarket + optionsStructural) * 100) / 100;
    const patrimonyGross = Math.round((base + optionsValue) * 100) / 100;
    const patrimony = Math.round((patrimonyGross + pending) * 100) / 100;
    const patrimonyAnchorDivergence = shouldCompareAnchor
      ? Math.round((patrimony - anchorTarget) * 100) / 100
      : 0;

    rawPoints.push({
      date,
      stocksValue: Math.round(stocksValue * 100) / 100,
      optionsStructural: Math.round(optionsStructural * 100) / 100,
      optionsValue,
      cash: Math.round(cash * 100) / 100,
      fixedIncome: Math.round(currentFixedIncome * 100) / 100,
      pendingSettlements: pending,
      scheduledCashPending: Math.round(scheduledCashPending * 100) / 100,
      patrimonyGross,
      patrimony,
      target: shouldCompareAnchor ? Math.round(anchorTarget * 100) / 100 : patrimony,
      patrimonyAnchorDivergence,
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
      scheduledCashPending: p.scheduledCashPending,
      settledCash: p.cash,
      cashInTransit: p.scheduledCashPending,
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
        periodGainBrl: performanceDaily.periodGainBrl,
      }
    : null;
  const returnsForSharpe =
    performance?.points
      .map((p) => p.dailyReturnAdjusted)
      .filter((r): r is number => r != null) ?? dailyReturnsFromPatrimony(series);
  const sharpe = computeSharpeRatio(returnsForSharpe, {
    riskFreeAnnual: options?.riskFreeAnnual ?? 0,
  });

  const lastPoint = rawPoints[rawPoints.length - 1];

  const positionSnapshots = snapshotOpenPositions(
    positions,
    stockQuotes,
    to,
    quoteForDate,
    lastKnownPrices,
    options
  );

  return {
    from,
    to,
    series,
    sharpe,
    performance,
    positionSnapshots,
    meta: {
      method: 'mtm_economic',
      settlement_rules: 'configured_contract_rules',
      compare_anchor: compareAnchor,
      patrimony_anchor_divergence: lastPoint?.patrimonyAnchorDivergence ?? 0,
      anchor_target: compareAnchor && lastPoint ? lastPoint.target : null,
      note:
        'Patrimonio economico (cotacoes + caixa + transito). Divergencia vs ancora BTG gera evento patrimony_anchor_divergence — sem plug/residual.',
    },
  };
}

function snapshotOpenPositions(
  positions: Map<string, DayPosition>,
  stockQuotes: StockQuoteMap,
  asOf: string,
  quoteForDate: PatrimonyMtmOptions['quoteForDate'] | undefined,
  lastKnownPrices: Map<string, number>,
  options?: PatrimonyMtmOptions
): PositionDailySnapshot[] {
  const out: PositionDailySnapshot[] = [];
  for (const p of positions.values()) {
    if (Math.abs(p.qty) < 0.0001) continue;
    if (isCash(p.assetType, p.ticker, options?.valuationContext)) continue;

    let resolved = resolvePositionMarkWithSource(
      p,
      asOf,
      quoteForDate,
      stockQuotes,
      lastKnownPrices,
      options,
      options?.valuationContext
    );
    let closing = resolved?.price;
    let priceSource: PositionDailySnapshot['priceSource'] = resolved?.source ?? 'cost';
    if (closing == null || !Number.isFinite(closing)) {
      if (isOptionType(p.assetType, options?.valuationContext)) {
        priceSource = p.expiry && asOf >= p.expiry ? 'expired_zero' : 'estimated_decay';
        closing = Math.abs(optionTimeMark(p, asOf)) / Math.max(Math.abs(p.qty), 1);
      } else {
        closing = p.unitCost;
      }
    }

    const marketValue = roundMoney(valueInBaseCurrency(p.qty * closing, p.assetType, asOf, options));
    const managerialValue = roundMoney(valueInBaseCurrency(p.qty * p.unitCost, p.assetType, asOf, options));
    out.push({
      assetId: p.assetId,
      ticker: p.ticker,
      assetType: p.assetType,
      quantity: Math.round(p.qty * 10000) / 10000,
      closingPrice: Math.round(closing * 10000) / 10000,
      unitCost: Math.round(p.unitCost * 10000) / 10000,
      marketValue,
      managerialValue,
      priceSource,
    });
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
}
