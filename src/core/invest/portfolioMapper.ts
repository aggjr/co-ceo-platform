import {
  inferAssetType,
  inferUnderlyingTicker,
  isFixedIncomeTicker,
  isOptionTicker,
} from './assetClassifier';
import type { AssetCustodyState } from './CustodyEngine';
import {
  inferOptionExpiryDate,
  inferOptionMonthFromTicker,
  isOptionExpired,
  localTodayIso,
} from './optionExpiry';
import type { OptionMarketRow } from './optionMarketCatalog';
import { resolveOptionStrike, type OptionStrikeSource } from './optionStrike';
import type { ThreePricesValidation } from './threePricesValidation';
import type { ThreeAvgPrices } from './portfolioThreePrices';
import { isCashInvestTicker } from './cashInvestLedger';
import {
  isTesouroDiretoTicker,
  TESOURO_SELIC_2031_TICKER,
} from './tesouroDirectLedger';

const OPTION_ASSET_TYPES = new Set(['option_call', 'option_put']);

export function isOptionAssetType(assetType: string): boolean {
  return OPTION_ASSET_TYPES.has(assetType);
}

const QTY_ZERO_EPS = 1e-9;

export function isPortfolioOptionItem(
  item: Pick<PortfolioItemDto, 'assetType' | 'ticker'>
): boolean {
  return isOptionAssetType(item.assetType) || isOptionTicker(item.ticker);
}

function isOptionLike(item: Pick<PortfolioItemDto, 'assetType' | 'ticker'>): boolean {
  return isPortfolioOptionItem(item);
}

/** Opção encerrada (qty/valor zerados) — transações finalizadas, não portfólio aberto. */
export function isClosedOptionPosition(
  item: Pick<PortfolioItemDto, 'assetType' | 'quantity' | 'ticker' | 'marketValue'>
): boolean {
  if (!isOptionLike(item)) return false;
  if (Math.abs(item.quantity) < QTY_ZERO_EPS) return true;
  if (Math.abs(item.marketValue) < 0.01 && Math.abs(item.quantity) < 1e-6) return true;
  return false;
}

function isFixedIncomePortfolioItem(
  item: Pick<PortfolioItemDto, 'assetType' | 'ticker'>
): boolean {
  return item.assetType === 'fixed_income' || isFixedIncomeTicker(item.ticker);
}

/** Renda fixa (Tesouro, CDB, LFT) com qty ≤ 0 — não entra na custódia aberta. */
export function isInvalidOpenCustodyPosition(
  item: Pick<PortfolioItemDto, 'assetType' | 'ticker' | 'quantity'>
): boolean {
  if (!isFixedIncomePortfolioItem(item)) return false;
  return Number(item.quantity) <= QTY_ZERO_EPS;
}

/** Opção com data de vencimento já passada — não entra na custódia aberta. */
export function isExpiredOptionPosition(
  item: Pick<PortfolioItemDto, 'assetType' | 'ticker' | 'optionExpiryDate'>,
  asOfDate = localTodayIso()
): boolean {
  if (!isOptionLike(item)) return false;
  return isOptionExpired(item.optionExpiryDate, asOfDate);
}

export function partitionPortfolioPositions(
  items: PortfolioItemDto[],
  asOfDate = localTodayIso()
): {
  open: PortfolioItemDto[];
  closedOptions: PortfolioItemDto[];
} {
  const open: PortfolioItemDto[] = [];
  const closedOptions: PortfolioItemDto[] = [];
  for (const item of items) {
    if (isClosedOptionPosition(item)) closedOptions.push(item);
    else if (isExpiredOptionPosition(item, asOfDate)) continue;
    else if (isInvalidOpenCustodyPosition(item)) continue;
    else open.push(item);
  }
  return { open, closedOptions };
}

export type PortfolioMetadata = {
  name?: string;
  sector?: string;
  last_price?: number;
  quote_as_of?: string;
  quote_source?: string;
  allocation_pct?: number;
  underlying_ticker?: string;
  notes?: string;
  /** Strike de exercício (R$) — obrigatório para notional/distância; não inferir do ticker. */
  option_strike?: number;
  option_strike_as_of?: string;
  option_expiration?: string;
};

export type PortfolioItemDto = {
  id: string;
  ticker: string;
  assetType: string;
  quantity: number;
  avgPrice: number;
  /** Preço médio estrito / B3 / gerencial (ações: dos três modos; opções: prêmio na custódia). */
  prices: ThreeAvgPrices;
  lastPrice: number;
  /** Cotação de mercado atualizada (sync B3 / metadata). */
  updatedQuote: number | null;
  marketValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  name: string;
  sector: string | null;
  underlying: string;
  allocationPct: number | null;
  status: string;
  /** Mês de vencimento (5ª letra do ticker B3). */
  optionMonthLetter: string | null;
  optionMonthName: string | null;
  optionExpiryDate: string | null;
  optionSide: 'call' | 'put' | null;
  /** Strike de exercício (metadata ou exercício E/F); null se não cadastrado. */
  optionStrike: number | null;
  optionStrikeSource: OptionStrikeSource;
  /** Prêmio recebido na venda (posição vendida / qty negativa). */
  premiumReceived: number;
  notional: number | null;
  /** Última cotação do papel objeto (da custódia de ações/FIIs). */
  underlyingLastPrice: number | null;
  /** Spot − strike (R$); positivo = ação acima do strike. */
  strikeDistanceBrl: number | null;
  /** (Spot − strike) / strike × 100. */
  strikeDistancePct: number | null;
  /** Batimento dos três preços (ações/FIIs) — revisão manual. */
  threePricesValidation?: ThreePricesValidation | null;
};

export type PortfolioSummaryDto = {
  positionCount: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalPnl: number;
  totalPnlPct: number;
};

/** % resultado de opção: (último − preço médio) / preço médio × 100. */
export function optionPriceReturnPct(lastPrice: number, avgPrice: number): number {
  if (!Number.isFinite(lastPrice) || !Number.isFinite(avgPrice) || avgPrice <= 0) return 0;
  return Math.round(((lastPrice - avgPrice) / avgPrice) * 10000) / 100;
}

function isEquityPortfolioItem(assetType: string, optionLike: boolean): boolean {
  return !optionLike && (assetType === 'stock' || assetType === 'fii');
}

/**
 * Resultado ações/FIIs: (cotação atualizada − PM B3) × quantidade.
 * Equivalente a (PM B3 − cotação) × (−qty) em vendido; em comprado, lucro quando cotação > PM B3.
 */
export function equityResultFromB3Quote(
  pmB3: number,
  updatedQuote: number,
  quantity: number
): number {
  if (!Number.isFinite(pmB3) || !Number.isFinite(updatedQuote) || !Number.isFinite(quantity)) {
    return 0;
  }
  return Math.round((updatedQuote - pmB3) * quantity * 100) / 100;
}

function parseMetadata(raw: unknown): PortfolioMetadata {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as PortfolioMetadata;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as PortfolioMetadata;
  return {};
}

/** Injeta strike/underlying do catálogo ou exercícios antes de enrichPortfolioRow. */
export function mergeOptionStrikeIntoAssetRow(
  row: Record<string, unknown>,
  ledgerStrikeByTicker: Map<string, number>,
  marketCatalog: Map<string, OptionMarketRow>
): Record<string, unknown> {
  const ticker = String(row.asset_ticker ?? '').toUpperCase();
  if (!isOptionTicker(ticker)) return row;
  const meta = parseMetadata(row.metadata);
  let changed = false;
  if (meta.option_strike == null) {
    const ledger = ledgerStrikeByTicker.get(ticker);
    const market = marketCatalog.get(ticker);
    if (ledger != null && ledger > 0) {
      meta.option_strike = ledger;
      changed = true;
    } else if (market?.strikePrice != null && market.strikePrice > 0) {
      meta.option_strike = market.strikePrice;
      changed = true;
    }
  }
  if (!meta.underlying_ticker) {
    const und =
      marketCatalog.get(ticker)?.underlyingTicker ||
      inferUnderlyingTicker(ticker, meta.underlying_ticker as string | undefined);
    if (und) {
      meta.underlying_ticker = und;
      changed = true;
    }
  }
  if (!meta.option_expiration && marketCatalog.get(ticker)?.expirationDate) {
    meta.option_expiration = marketCatalog.get(ticker)!.expirationDate;
    changed = true;
  }
  if (!changed) return row;
  return { ...row, metadata: JSON.stringify(meta) };
}

export type MarketQuoteHint = { price: number; asOf?: string };

export function enrichPortfolioRow(
  row: Record<string, unknown>,
  threePrices?: ThreeAvgPrices,
  strikeHints?: {
    ledgerStrikeByTicker?: Map<string, number>;
    marketCatalog?: Map<string, OptionMarketRow>;
  },
  marketQuote?: MarketQuoteHint | null
): PortfolioItemDto {
  const meta = parseMetadata(row.metadata);
  const qty = Number(row.current_quantity ?? 0);
  const avg = Number(row.managerial_avg_price ?? 0);
  const prices =
    threePrices ??
    ({ strict: avg, b3: avg, managerial: avg } satisfies ThreeAvgPrices);
  const metaLast = Number(meta.last_price ?? 0);
  const ticker = String(row.asset_ticker ?? '').trim().toUpperCase();
  let assetType = String(row.asset_type ?? '').trim();
  const inferred = inferAssetType(ticker);
  if (
    inferred === 'fixed_income' ||
    inferred === 'cash' ||
    isOptionAssetType(inferred) ||
    inferred === 'fii'
  ) {
    assetType = inferred;
  } else if (!assetType || (assetType === 'stock' && isFixedIncomeTicker(ticker))) {
    assetType = inferred;
  }
  const optionLike = isOptionTicker(ticker) || isOptionAssetType(assetType);
  const acqVal = Number(row.acquisition_value ?? 0);
  const curVal = Number(row.current_value ?? 0);
  const custodyUnitPm =
    Math.abs(qty) > QTY_ZERO_EPS ? Math.abs(acqVal / qty) : 0;
  const custodyUnitMark =
    Math.abs(qty) > QTY_ZERO_EPS ? Math.abs(curVal / qty) : 0;

  let displayAvg = prices.managerial > 0 ? prices.managerial : avg;
  if (optionLike) {
    if (custodyUnitPm > 0) displayAvg = custodyUnitPm;
    else if (avg > 0) displayAvg = avg;
    else if (avg < 0) displayAvg = Math.abs(avg);
  } else {
    displayAvg = prices.managerial > 0 ? prices.managerial : avg;
  }

  const marketPx =
    marketQuote != null &&
    Number.isFinite(marketQuote.price) &&
    marketQuote.price > 0
      ? marketQuote.price
      : null;
  const equityLike = isEquityPortfolioItem(assetType, optionLike);

  let lastPrice = metaLast > 0 ? metaLast : displayAvg;
  let updatedQuote: number | null = null;

  if (optionLike) {
    if (metaLast > 0) lastPrice = metaLast;
    else if (custodyUnitMark > 0) lastPrice = custodyUnitMark;
    else if (displayAvg > 0) lastPrice = displayAvg;
    updatedQuote =
      metaLast > 0 ? metaLast : custodyUnitMark > 0 ? custodyUnitMark : null;
  } else if (equityLike) {
    // Cotação de mercado (market_quotes_daily / brapi) — nunca confundir com PM do livro.
    updatedQuote = marketPx;
    lastPrice = marketPx ?? 0;
  } else {
    updatedQuote = metaLast > 0 ? metaLast : null;
  }
  const pmB3 = prices.b3 > 0 ? prices.b3 : 0;
  let marketValue = qty * lastPrice;
  let costBasis = qty * displayAvg;
  let pnl = marketValue - costBasis;
  if (optionLike && !isOptionAssetType(assetType)) {
    const inferredSide = inferOptionMonthFromTicker(ticker)?.optionSide;
    assetType = inferredSide === 'put' ? 'option_put' : 'option_call';
  }
  const optionMonth = optionLike ? inferOptionMonthFromTicker(ticker) : null;
  const optionExpiryDate = optionMonth ? inferOptionExpiryDate(ticker) : null;
  const strikeResolved = optionLike
    ? resolveOptionStrike({
        meta,
        ticker,
        ledgerExerciseStrike: strikeHints?.ledgerStrikeByTicker?.get(ticker),
        marketStrike: strikeHints?.marketCatalog?.get(ticker)?.strikePrice,
      })
    : { strike: null, source: null };
  const optionStrike = strikeResolved.strike;
  const premiumReceived =
    optionLike && qty < 0 && displayAvg > 0
      ? Math.round(Math.abs(qty) * displayAvg * 100) / 100
      : 0;
  const notional =
    optionStrike != null && optionStrike > 0
      ? Math.round(Math.abs(qty) * optionStrike * 100) / 100
      : null;

  if (optionLike && Math.abs(qty) > QTY_ZERO_EPS && displayAvg > 0) {
    const absQ = Math.abs(qty);
    const mark = lastPrice > 0 ? lastPrice : displayAvg;
    costBasis = Math.round(displayAvg * absQ * 100) / 100;
    marketValue = Math.round(mark * absQ * 100) / 100;
    if (qty < 0) {
      pnl = Math.round((displayAvg - mark) * absQ * 100) / 100;
    } else {
      pnl = Math.round((mark - displayAvg) * absQ * 100) / 100;
    }
  }

  if (equityLike) {
    const quote = updatedQuote ?? 0;
    costBasis = pmB3 > 0 ? Math.round(qty * pmB3 * 100) / 100 : 0;
    marketValue = quote > 0 ? Math.round(qty * quote * 100) / 100 : 0;
    if (pmB3 > 0 && quote > 0) {
      pnl = equityResultFromB3Quote(pmB3, quote, qty);
    } else {
      pnl = 0;
    }
  }

  const pnlPct = optionLike
    ? optionPriceReturnPct(lastPrice, displayAvg)
    : equityLike && pmB3 > 0 && updatedQuote != null && updatedQuote > 0
      ? optionPriceReturnPct(updatedQuote, pmB3)
      : costBasis > 0
        ? (pnl / costBasis) * 100
        : 0;

  return {
    id: String(row.id),
    ticker,
    assetType,
    quantity: qty,
    avgPrice: displayAvg,
    prices,
    lastPrice,
    updatedQuote,
    marketValue,
    costBasis,
    pnl,
    pnlPct,
    name: meta.name ?? String(row.asset_ticker ?? ''),
    sector: meta.sector ?? null,
    underlying: inferUnderlyingTicker(ticker, meta.underlying_ticker),
    allocationPct: meta.allocation_pct != null ? Number(meta.allocation_pct) : null,
    status: String(row.status ?? 'active'),
    optionMonthLetter: optionMonth?.letter ?? null,
    optionMonthName: optionMonth?.monthName ?? null,
    optionExpiryDate,
    optionSide: optionMonth?.optionSide ?? null,
    optionStrike,
    optionStrikeSource: strikeResolved.source,
    premiumReceived,
    notional,
    underlyingLastPrice: null,
    strikeDistanceBrl: null,
    strikeDistancePct: null,
  };
}

/** Notional = |qty| × strike; cotação e distância ao strike para risco de exercício. */
export function attachUnderlyingMarketData(items: PortfolioItemDto[]): PortfolioItemDto[] {
  const spotByTicker = new Map<string, number>();
  for (const item of items) {
    if (isPortfolioOptionItem(item)) continue;
    const lp = Number(item.lastPrice);
    if (lp > 0) spotByTicker.set(item.ticker.toUpperCase(), lp);
  }

  return items.map((item) => {
    if (!isPortfolioOptionItem(item)) return item;

    const strike =
      item.optionStrike != null && item.optionStrike > 0 ? item.optionStrike : null;
    const qtyAbs = Math.abs(item.quantity);
    const notional =
      strike != null && strike > 0
        ? Math.round(qtyAbs * strike * 100) / 100
        : null;

    const underlyingKey = String(item.underlying || '').toUpperCase();
    const underlyingLastPrice = underlyingKey
      ? (spotByTicker.get(underlyingKey) ?? null)
      : null;

    let strikeDistanceBrl: number | null = null;
    let strikeDistancePct: number | null = null;
    if (underlyingLastPrice != null && strike != null && strike > 0) {
      strikeDistanceBrl = Math.round((underlyingLastPrice - strike) * 100) / 100;
      strikeDistancePct =
        Math.round(((underlyingLastPrice - strike) / strike) * 10000) / 100;
    }

    return {
      ...item,
      optionStrike: strike,
      notional,
      underlyingLastPrice,
      strikeDistanceBrl,
      strikeDistancePct,
    };
  });
}

/**
 * Atualiza quantidades/preços a partir do livro-razão (ex.: CALLs vendidas no dia ainda não refletidas na snapshot).
 */
export function mergeLedgerCustodyIntoAssetRows(
  assetRows: Record<string, unknown>[],
  ledgerAssets: AssetCustodyState[]
): Record<string, unknown>[] {
  const byTicker = new Map<string, Record<string, unknown>>();
  for (const row of assetRows) {
    byTicker.set(String(row.asset_ticker ?? '').toUpperCase(), row);
  }
  const merged = assetRows.map((r) => ({ ...r }));

  for (const la of ledgerAssets) {
    const key = la.ticker.toUpperCase();
    const hit = byTicker.get(key);
    if (hit) {
      hit.current_quantity = la.quantity;
      if (la.avgPrice > 0) {
        hit.managerial_avg_price = la.avgPrice;
      }
      hit.status = 'active';
      const meta = parseMetadata(hit.metadata);
      if (la.underlying && !meta.underlying_ticker) {
        meta.underlying_ticker = la.underlying;
        hit.metadata = meta;
      }
      continue;
    }
    const row: Record<string, unknown> = {
      id: la.assetId,
      asset_ticker: la.ticker,
      asset_type: la.assetType,
      current_quantity: la.quantity,
      managerial_avg_price: la.avgPrice,
      metadata: la.underlying ? { underlying_ticker: la.underlying } : {},
      status: 'active',
    };
    merged.push(row);
    byTicker.set(key, row);
  }
  return merged;
}

/** Une LFT-20310301 + TESOURO-SELIC-2031 numa única linha de Tesouro Selic 2031. */
export function consolidateTesouroPortfolioItems(
  items: PortfolioItemDto[]
): PortfolioItemDto[] {
  const rest: PortfolioItemDto[] = [];
  const tesouro: PortfolioItemDto[] = [];
  for (const item of items) {
    if (isTesouroDiretoTicker(item.ticker)) tesouro.push(item);
    else rest.push(item);
  }
  if (tesouro.length === 0) return items;

  let totalQty = 0;
  let costSum = 0;
  let best = tesouro[0]!;
  for (const t of tesouro) {
    totalQty += t.quantity;
    costSum += t.quantity * t.avgPrice;
    if (Math.abs(t.quantity) > Math.abs(best.quantity)) best = t;
  }
  if (totalQty <= 1e-9) return rest;

  const avgPrice = costSum / totalQty;
  const lastPrice = best.lastPrice > 0 ? best.lastPrice : avgPrice;
  const marketValue = Math.round(totalQty * lastPrice * 100) / 100;
  const costBasis = Math.round(totalQty * avgPrice * 100) / 100;
  const pnl = Math.round((marketValue - costBasis) * 100) / 100;

  rest.push({
    ...best,
    ticker: TESOURO_SELIC_2031_TICKER,
    assetType: 'fixed_income',
    name: best.name || 'Tesouro Selic 2031 (LFT)',
    quantity: Math.round(totalQty * 10000) / 10000,
    avgPrice: Math.round(avgPrice * 10000) / 10000,
    lastPrice,
    marketValue,
    costBasis,
    pnl,
    pnlPct: costBasis !== 0 ? Math.round((pnl / costBasis) * 10000) / 100 : 0,
  });
  return rest;
}

/** Ajusta linha CAIXA-BTG para saldo em R$ (extrato / livro-razão). */
export function applyCashInvestBalanceToItems(
  items: PortfolioItemDto[],
  balance: number
): PortfolioItemDto[] {
  const b = Math.round(balance * 100) / 100;
  return items.map((item) => {
    if (!isCashInvestTicker(item.ticker) && item.assetType !== 'cash') return item;
    return {
      ...item,
      quantity: b,
      avgPrice: 1,
      prices: { strict: 1, b3: 1, managerial: 1 },
      lastPrice: 1,
      updatedQuote: 1,
      marketValue: b,
      costBasis: b,
      pnl: 0,
      pnlPct: 0,
    };
  });
}

export function applyAllocationPercents(items: PortfolioItemDto[]): PortfolioItemDto[] {
  const total = items.reduce((s, i) => {
    if (Math.abs(i.quantity) < QTY_ZERO_EPS) return s;
    if (
      i.assetType === 'stock' ||
      i.assetType === 'fii' ||
      isPortfolioOptionItem(i)
    ) {
      return s + Math.abs(i.marketValue);
    }
    return s;
  }, 0);
  if (total <= 0) return items;
  return items.map((item) => ({
    ...item,
    allocationPct:
      item.allocationPct != null
        ? item.allocationPct
        : item.assetType === 'stock' ||
            item.assetType === 'fii' ||
            isPortfolioOptionItem(item)
          ? Math.round((Math.abs(item.marketValue) / total) * 1000) / 10
          : null,
  }));
}

export function summarizePortfolio(items: PortfolioItemDto[]): PortfolioSummaryDto {
  const totalMarketValue = items.reduce((s, i) => s + i.marketValue, 0);
  const totalCostBasis = items.reduce((s, i) => {
    if (i.assetType === 'stock' || i.assetType === 'fii') {
      const b3 = i.prices?.b3 ?? 0;
      return s + (b3 > 0 ? Math.round(i.quantity * b3 * 100) / 100 : 0);
    }
    return s + i.costBasis;
  }, 0);
  const totalPnl = items.reduce((s, i) => {
    if (i.assetType === 'stock' || i.assetType === 'fii') {
      const b3 = i.prices?.b3 ?? 0;
      const quote = i.updatedQuote ?? 0;
      if (b3 > 0 && quote > 0) {
        return s + equityResultFromB3Quote(b3, quote, i.quantity);
      }
      return s;
    }
    return s + i.pnl;
  }, 0);
  const totalPnlPct = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;
  return {
    positionCount: items.length,
    totalMarketValue,
    totalCostBasis,
    totalPnl,
    totalPnlPct,
  };
}
