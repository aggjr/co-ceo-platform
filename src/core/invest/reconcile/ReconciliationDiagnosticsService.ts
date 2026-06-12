import { CoCeoDataGateway, type UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import { BrokerCustodySnapshotRepository } from '../BrokerCustodySnapshotRepository';
import type { BrokerCustodySnapshotRecord } from '../brokerCustodySnapshotTypes';
import { rebuildCustodyFromLedger, type LedgerEvent } from '../CustodyEngine';
import { inferAssetType, inferUnderlyingTicker, isFixedIncomeTicker, isOptionTicker } from '../assetClassifier';
import { LedgerImportService } from '../LedgerImportService';
import { computeThreePricesByUnderlying } from '../threePricesEngine';
import { ThreePricesContextFactory } from '../ThreePricesContextFactory';
import { buildCashInTransitSummary } from '../cashInTransit';
import { cashBalanceFromLedger, settledCashBalanceFromLedger } from '../cashInvestLedger';
import { fixedIncomeTotalFromLedger } from '../patrimonyLedgerGates';
import { AUTO_D2_REF_PREFIX } from '../AutoPendingSettlementSync';
import {
  AssetValuationContext,
  categoryFor,
  type AssetValuationSnapshot,
} from '../valuation/AssetValuationContext';
import { InvestBookPeriodService } from '../InvestBookPeriodService';

type StoredPosition = {
  ticker: string;
  assetType: string;
  quantity: number;
  acquisitionValue: number;
  currentValue: number;
  pmEstrito: number | null;
  pmB3: number | null;
  pmGerencial: number | null;
  lastPrice: number | null;
};

type BrokerQty = {
  markQty: number;
  pendingQty: number;
  totalQty: number;
  marketValue: number;
  avgPrice: number | null;
  lastPrice: number | null;
  lineKinds: string;
};

type DailyFinancialAuditRow = {
  id: string;
  date: string;
  openingCash: number;
  openingTransit: number;
  assetMovementValue: number;
  pureFinancialValue: number;
  transitChange: number;
  closingTransit: number;
  closingCash: number;
  closingCashWithTransit: number;
  assetDetails: string;
  pureFinancialDetails: string;
  transitDetails: string;
};

type DailyBusinessAuditRow = {
  id: string;
  date: string;
  status: 'ok' | 'warn' | 'error';
  finding: string;
  businessEvents: number;
  bothSidesEvents: number;
  financialOnlyEvents: number;
  assetOnlyEvents: number;
  missingBusinessEventCount: number;
  linkedAssetExpectedCash: number;
  linkedFinancialCash: number;
  eventCashDelta: number;
  businessExplanation: string;
  unlinkedExplanation: string;
};

type DailyPortfolioAuditRow = {
  id: string;
  date: string;
  openingPatrimonyValue: number;
  openingPortfolioValue: number;
  assetMovementDelta: number;
  closingPortfolioValue: number;
  closingPatrimonyValue: number;
  totalPatrimonyFromSheets: number;
  changedAssets: string;
  consideredAssets: string;
};

type AuditPositionState = {
  ticker: string;
  assetType: string;
  qty: number;
  unitValue: number;
};

type AuditPendingCashState = {
  amount: number;
  settleDate: string | null;
};

function round(n: number, scale = 4): number {
  const p = 10 ** scale;
  return Math.round((Number(n) || 0) * p) / p;
}

function money(n: number): number {
  return round(n, 2);
}

function toIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isCashTicker(ticker: string, assetType?: string): boolean {
  const t = ticker.toUpperCase();
  return assetType === 'cash' || t === 'CAIXA' || t.startsWith('CAIXA-');
}

function isFixedIncome(assetType: string, ticker: string): boolean {
  return assetType === 'fixed_income' || isFixedIncomeTicker(ticker);
}

function toleranceForQty(ticker: string): number {
  return isOptionTicker(ticker) ? 0.0001 : 0.001;
}

function statusFromDelta(delta: number, eps: number): 'ok' | 'warn' | 'error' {
  const abs = Math.abs(delta);
  if (abs <= eps) return 'ok';
  if (abs <= Math.max(1, eps * 100)) return 'warn';
  return 'error';
}

function chooseCompareStatus(
  ledgerQty: number,
  brokerMarkQty: number,
  brokerTotalQty: number,
  ticker: string,
  hasSnapshot: boolean
): { status: 'ok' | 'warn' | 'error' | 'missing_broker'; basis: string; delta: number } {
  if (!hasSnapshot) {
    return { status: 'warn', basis: 'snapshot ausente', delta: 0 };
  }
  if (brokerMarkQty === 0 && brokerTotalQty === 0) {
    return Math.abs(ledgerQty) <= toleranceForQty(ticker)
      ? { status: 'ok', basis: 'sem posicao broker', delta: 0 }
      : { status: 'missing_broker', basis: 'sem ticker no snapshot', delta: ledgerQty };
  }
  const eps = toleranceForQty(ticker);
  const deltaMark = round(ledgerQty - brokerMarkQty);
  const deltaTotal = round(ledgerQty - brokerTotalQty);
  const markStatus = statusFromDelta(deltaMark, eps);
  const totalStatus = statusFromDelta(deltaTotal, eps);
  if (markStatus === 'ok') return { status: 'ok', basis: 'mark', delta: deltaMark };
  if (totalStatus === 'ok') return { status: 'ok', basis: 'mark+pendentes', delta: deltaTotal };
  if (markStatus === 'warn' || totalStatus === 'warn') {
    return Math.abs(deltaMark) <= Math.abs(deltaTotal)
      ? { status: 'warn', basis: 'mark', delta: deltaMark }
      : { status: 'warn', basis: 'mark+pendentes', delta: deltaTotal };
  }
  return Math.abs(deltaMark) <= Math.abs(deltaTotal)
    ? { status: 'error', basis: 'mark', delta: deltaMark }
    : { status: 'error', basis: 'mark+pendentes', delta: deltaTotal };
}

function tradeSignedCash(e: LedgerEvent): number {
  const type = String(e.transaction_type);
  const abs = Math.abs(Number(e.total_net_value ?? 0));
  if (['buy', 'put_buy', 'call_buy'].includes(type)) return -abs;
  if (['sell', 'put_sell', 'call_sell'].includes(type)) return abs;
  return Number(e.total_net_value ?? 0);
}

function isBusinessTrade(e: LedgerEvent): boolean {
  const type = String(e.transaction_type);
  return ['buy', 'sell', 'put_buy', 'put_sell', 'call_buy', 'call_sell', 'option_exercise'].includes(type);
}

function eventCashValue(e: LedgerEvent): number {
  if (!isCashTicker(String(e.asset_ticker || ''), String(e.asset_type || ''))) return 0;
  return Number(e.total_net_value ?? 0);
}

function isPendingSettlementClear(e: LedgerEvent): boolean {
  return String(e.transaction_type) === 'pending_settlement' && String(e.broker_note_ref || '').endsWith(':CLEAR');
}

function dailyBusinessCashValue(e: LedgerEvent): number {
  if (isPendingSettlementClear(e)) return 0;
  return eventCashValue(e);
}

function dateRange(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return [];
  }
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function detailList(items: string[], max = 18): string {
  if (!items.length) return '';
  if (items.length <= max) return items.join(' | ');
  return `${items.slice(0, max).join(' | ')} | +${items.length - max} item(ns)`;
}

function signedOpeningQty(e: LedgerEvent): number {
  const q = Math.abs(Number(e.quantity ?? 0));
  const ticker = String(e.asset_ticker || '').toUpperCase();
  const type = String(e.asset_type || inferAssetType(ticker));
  if ((type === 'option_call' || type === 'option_put') && Number(e.total_net_value ?? 0) < -0.005) {
    return -q;
  }
  return q;
}

function assetQuantityDelta(e: LedgerEvent, currentQty: number): number | null {
  const type = String(e.transaction_type);
  const q = Number(e.quantity ?? 0);
  if (type === 'opening_balance') return signedOpeningQty(e) - currentQty;
  if (type === 'buy' || type === 'put_buy' || type === 'call_buy' || type === 'bonus') return Math.abs(q);
  if (type === 'sell' || type === 'put_sell' || type === 'call_sell') return -Math.abs(q);
  if (type === 'option_exercise') return q;
  return null;
}

export class ReconciliationDiagnosticsService {
  private readonly ledger: LedgerImportService;
  private readonly snapshots: BrokerCustodySnapshotRepository;
  private readonly valuationContext: AssetValuationContext;
  private readonly threePricesFactory: ThreePricesContextFactory;
  private readonly periods: InvestBookPeriodService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.snapshots = new BrokerCustodySnapshotRepository(gateway);
    this.valuationContext = new AssetValuationContext(gateway);
    this.threePricesFactory = new ThreePricesContextFactory(gateway);
    this.periods = new InvestBookPeriodService(gateway);
  }

  async getFinancialDiagnostics(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<DailyFinancialAuditRow[]> {
    const report = await this.build(ctx, to);
    return report.dailyAudit.financial.filter((row) => row.date >= from && row.date <= report.asOf);
  }

  async getEventsDiagnostics(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<DailyBusinessAuditRow[]> {
    const report = await this.build(ctx, to);
    return report.dailyAudit.business.filter((row) => row.date >= from && row.date <= report.asOf);
  }

  async getPortfolioDiagnostics(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<DailyPortfolioAuditRow[]> {
    const report = await this.build(ctx, to);
    return report.dailyAudit.portfolio.filter((row) => row.date >= from && row.date <= report.asOf);
  }

  async build(ctx: UserContext, asOfInput?: string) {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Personifique a holding para conferir a conciliacao.', 400);
    }

    const latestSnapshot = await this.snapshots.loadLatest(ctx).catch(() => null);
    const asOf = (asOfInput || latestSnapshot?.referenceDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const period = await this.resolvePeriodOrNull(ctx);
    const events = await this.ledger.listLedgerEvents(ctx, period?.openingDate ?? '2000-01-01', asOf);
    const custody = rebuildCustodyFromLedger(events);
    const threeCtx = await this.threePricesFactory.build(ctx);
    const threePrices = computeThreePricesByUnderlying(events, { ctx: threeCtx }, asOf);
    const valuation = await this.valuationContext.load(ctx);
    const stored = await this.loadStoredPositions(ctx);
    const broker = this.aggregateBroker(latestSnapshot);

    const assetRows = this.buildAssetRows(
      custody.assets,
      stored,
      broker,
      threePrices,
      valuation,
      Boolean(latestSnapshot)
    );
    const eventRows = this.buildBusinessEventRows(events);
    const cashRows = this.buildCashRows(events, latestSnapshot, asOf);
    const dailyAudit = this.buildDailyAuditRows(events, asOf, period?.openingDate ?? null);
    const resetRows = await this.buildResetRows(ctx);
    const critical = this.buildCriticalFindings(assetRows, eventRows, cashRows, resetRows);
    if (!latestSnapshot) {
      critical.unshift({
        id: 'snapshot-missing',
        area: 'Home broker',
        severity: 'error',
        finding:
          'Snapshot de custodia nao encontrado. Os JSON mensais de patrimonio servem como ancoras, mas nao conferem quantidade por ativo. Importe um JSON com referenceDate, composition e positions[].',
      });
    }

    return {
      success: true,
      asOf,
      snapshot: latestSnapshot
        ? {
            id: latestSnapshot.id,
            referenceDate: latestSnapshot.referenceDate,
            status: latestSnapshot.status,
            sourceLabel: latestSnapshot.sourceLabel,
            composition: latestSnapshot.composition,
          }
        : null,
      summary: {
        assets: assetRows.length,
        assetErrors: assetRows.filter((r) => r.status === 'error' || r.status === 'missing_broker').length,
        eventErrors: eventRows.filter((r) => r.status === 'error').length,
        cashErrors: cashRows.filter((r) => r.status === 'error').length,
        resetErrors: resetRows.filter((r) => r.status === 'error').length,
        criticalFindings: critical.length,
      },
      critical,
      assets: assetRows,
      businessEvents: eventRows,
      cash: cashRows,
      dailyAudit,
      reset: resetRows,
    };
  }

  private async loadStoredPositions(ctx: UserContext): Promise<Map<string, StoredPosition>> {
    const items = await this.gateway.findWhere(ctx, 'patrimony_items', {
      organization_id: ctx.organizationId,
      source_module: 'INVEST',
    });
    const exts = await this.gateway.findWhere(ctx, 'invest_position_ext', {
      organization_id: ctx.organizationId,
    });
    const extByItem = new Map(exts.map((e) => [String(e.patrimony_item_id), e]));
    const out = new Map<string, StoredPosition>();
    for (const it of items) {
      const ticker = String(it.identifier ?? '').toUpperCase();
      if (!ticker) continue;
      const ext = extByItem.get(String(it.id));
      const meta = parseMeta(it.metadata);
      const assetType = String(ext?.asset_class ?? it.subcategory ?? meta.asset_type ?? inferAssetType(ticker));
      out.set(ticker, {
        ticker,
        assetType,
        quantity: Number(it.quantity ?? 0),
        acquisitionValue: Number(it.acquisition_value ?? 0),
        currentValue: Number(it.current_value ?? 0),
        pmEstrito: ext?.pm_estrito != null ? Number(ext.pm_estrito) : null,
        pmB3: ext?.pm_b3 != null ? Number(ext.pm_b3) : null,
        pmGerencial: ext?.pm_gerencial != null ? Number(ext.pm_gerencial) : null,
        lastPrice: ext?.last_price != null ? Number(ext.last_price) : null,
      });
    }
    return out;
  }

  private aggregateBroker(snapshot: BrokerCustodySnapshotRecord | null): Map<string, BrokerQty> {
    const out = new Map<string, BrokerQty>();
    if (!snapshot) return out;
    for (const line of snapshot.positions || []) {
      const ticker = String(line.ticker || '').toUpperCase();
      if (!ticker) continue;
      const prev = out.get(ticker) || {
        markQty: 0,
        pendingQty: 0,
        totalQty: 0,
        marketValue: 0,
        avgPrice: null,
        lastPrice: null,
        lineKinds: '',
      };
      const qty = Number(line.quantity ?? 0);
      if (line.lineKind === 'mark') prev.markQty += qty;
      else prev.pendingQty += qty;
      prev.totalQty += qty;
      prev.marketValue += Number(line.marketValue ?? 0);
      if (line.avgPrice != null) prev.avgPrice = Number(line.avgPrice);
      if (line.lastPrice != null) prev.lastPrice = Number(line.lastPrice);
      const kind = line.legTag ? `${line.lineKind}:${line.legTag}` : line.lineKind;
      prev.lineKinds = [...new Set([...(prev.lineKinds ? prev.lineKinds.split(', ') : []), kind])].join(', ');
      out.set(ticker, prev);
    }
    return out;
  }

  private buildAssetRows(
    ledgerAssets: ReturnType<typeof rebuildCustodyFromLedger>['assets'],
    stored: Map<string, StoredPosition>,
    broker: Map<string, BrokerQty>,
    threePrices: ReturnType<typeof computeThreePricesByUnderlying>,
    valuation: AssetValuationSnapshot,
    hasSnapshot: boolean
  ) {
    const tickers = new Set<string>();
    for (const a of ledgerAssets) tickers.add(String(a.ticker).toUpperCase());
    for (const t of stored.keys()) tickers.add(t);
    for (const t of broker.keys()) tickers.add(t);

    const ledgerByTicker = new Map(ledgerAssets.map((a) => [String(a.ticker).toUpperCase(), a]));
    const rows = [...tickers].sort().map((ticker) => {
      const ledger = ledgerByTicker.get(ticker);
      const st = stored.get(ticker);
      const br = broker.get(ticker) || {
        markQty: 0,
        pendingQty: 0,
        totalQty: 0,
        marketValue: 0,
        avgPrice: null,
        lastPrice: null,
        lineKinds: '',
      };
      const assetType = String(ledger?.assetType ?? st?.assetType ?? inferAssetType(ticker));
      const ledgerQty = round(Number(ledger?.quantity ?? 0));
      const storedQty = round(Number(st?.quantity ?? 0));
      const compare = chooseCompareStatus(
        ledgerQty,
        round(br.markQty),
        round(br.totalQty),
        ticker,
        hasSnapshot
      );
      const storedDelta = round(storedQty - ledgerQty);
      let status = compare.status;
      const notes: string[] = [];
      if (Math.abs(storedDelta) > toleranceForQty(ticker)) {
        status = status === 'error' || status === 'missing_broker' ? status : 'warn';
        notes.push(`patrimony_items difere do livro (${storedDelta})`);
      }
      if (compare.status !== 'ok' && hasSnapshot) {
        notes.push(`delta broker ${compare.basis}: ${compare.delta}`);
      }
      if (!hasSnapshot) notes.push('snapshot broker ausente; sem batimento contra corretora');
      if (!ledger && (Math.abs(br.totalQty) > 0 || Math.abs(storedQty) > 0)) {
        notes.push('sem posicao no livro projetado');
      }
      const und = inferUnderlyingTicker(ticker);
      const prices = threePrices.get(und) ?? threePrices.get(ticker);
      const category = categoryFor(valuation, assetType);
      const requiresThreePrices =
        category?.valuationMode === 'market_price' &&
        category.settlementContractTypeCode === 'B3_EQUITY_SPOT';
      if (requiresThreePrices && (!prices || prices.qty <= 0 || prices.estrito <= 0)) {
        status = 'error';
        notes.push('3 precos ausentes/zerados para ativo com precificacao B3_EQUITY_SPOT');
      }
      const avgDelta =
        br.avgPrice != null && prices?.estrito != null && prices.estrito > 0
          ? round((prices.estrito ?? 0) - Number(br.avgPrice), 4)
          : null;
      return {
        id: `asset-${ticker}`,
        status,
        ticker,
        assetType,
        underlying: und,
        ledgerQty,
        storedQty,
        brokerMarkQty: round(br.markQty),
        brokerPendingQty: round(br.pendingQty),
        brokerTotalQty: round(br.totalQty),
        qtyDelta: compare.delta,
        compareBasis: compare.basis,
        pmEstrito: prices?.estrito ?? st?.pmEstrito ?? null,
        pmB3: prices?.b3 ?? st?.pmB3 ?? null,
        pmGerencial: prices?.gerencial ?? st?.pmGerencial ?? null,
        brokerAvgPrice: br.avgPrice,
        avgPriceDelta: avgDelta,
        lastPrice: br.lastPrice ?? st?.lastPrice ?? null,
        brokerMarketValue: money(br.marketValue),
        storedCurrentValue: money(st?.currentValue ?? 0),
        lineKinds: br.lineKinds,
        finding: notes.join(' | ') || 'OK',
      };
    });
    return rows.filter((r) => !isCashTicker(r.ticker, r.assetType));
  }

  private buildBusinessEventRows(events: LedgerEvent[]) {
    const byEvent = new Map<string, LedgerEvent[]>();
    const orphans: LedgerEvent[] = [];
    for (const e of events) {
      if (String(e.transaction_type) === 'opening_balance') continue;
      if (e.business_event_id) {
        const id = String(e.business_event_id);
        byEvent.set(id, [...(byEvent.get(id) || []), e]);
      } else if (String(e.transaction_type) !== 'opening_balance') {
        orphans.push(e);
      }
    }

    const rows = [...byEvent.entries()].map(([eventId, legs]) => {
      const patrimony = legs.filter((e) => !isCashTicker(String(e.asset_ticker || ''), String(e.asset_type || '')));
      const cash = legs.filter((e) => isCashTicker(String(e.asset_ticker || ''), String(e.asset_type || '')));
      const tradeCash = money(patrimony.filter(isBusinessTrade).reduce((s, e) => s + tradeSignedCash(e), 0));
      const clearedCash = money(cash.filter((e) => String(e.transaction_type) !== 'pending_settlement').reduce((s, e) => s + eventCashValue(e), 0));
      const pendingCash = money(cash.filter((e) => String(e.transaction_type) === 'pending_settlement').reduce((s, e) => s + eventCashValue(e), 0));
      const hasTrade = patrimony.some(isBusinessTrade);
      const hasCleared = Math.abs(clearedCash) > 0.005;
      const pendingRefs = new Map<string, number>();
      for (const c of cash) {
        if (String(c.transaction_type) !== 'pending_settlement') continue;
        const ref = String(c.broker_note_ref || '');
        const base = ref.endsWith(':CLEAR') ? ref.slice(0, -':CLEAR'.length) : ref;
        pendingRefs.set(base, (pendingRefs.get(base) ?? 0) + Number(c.total_net_value ?? 0));
      }
      const openPending = money([...pendingRefs.values()].reduce((s, v) => s + v, 0));
      const clearedCashLegs = cash.filter((e) => String(e.transaction_type) !== 'pending_settlement').length;
      const duplicateRisk =
        hasTrade &&
        hasCleared &&
        clearedCashLegs > 1 &&
        Math.abs(clearedCash) > Math.abs(tradeCash) + 0.05;
      const cashDelta = money(clearedCash - tradeCash);
      let status: 'ok' | 'warn' | 'error' = 'ok';
      const notes: string[] = [];
      if (duplicateRisk) {
        status = 'error';
        notes.push('possivel duplicidade: mais de uma perna de caixa liquidada no evento');
      }
      if (hasTrade && !hasCleared) {
        status = status === 'error' ? status : 'warn';
        notes.push('trade sem perna financeira liquidada');
      }
      if (Math.abs(openPending) > 0.005) {
        status = 'error';
        notes.push(`saldo transitorio aberto: ${openPending}`);
      }
      if (hasTrade && hasCleared && Math.abs(cashDelta) > 0.05) {
        status = 'error';
        notes.push(`caixa liquidado difere do esperado: ${cashDelta}`);
      }
      const first = legs[0];
      return {
        id: `event-${eventId}`,
        status,
        eventId,
        date: String(first.transaction_date || '').slice(0, 10),
        tickers: [...new Set(patrimony.map((e) => String(e.asset_ticker).toUpperCase()))].join(', '),
        patrimonyLegs: patrimony.length,
        cashLegs: cash.length,
        tradeCash,
        clearedCash,
        pendingCash,
        openPending,
        finding: notes.join(' | ') || 'OK',
      };
    });

    for (const e of orphans) {
      const ticker = String(e.asset_ticker || '').toUpperCase();
      const type = String(e.transaction_type || '');
      rows.push({
        id: `orphan-${e.id || ticker}-${type}`,
        status: isCashTicker(ticker, String(e.asset_type || '')) ? 'warn' : 'error',
        eventId: '',
        date: String(e.transaction_date || '').slice(0, 10),
        tickers: ticker,
        patrimonyLegs: isCashTicker(ticker, String(e.asset_type || '')) ? 0 : 1,
        cashLegs: isCashTicker(ticker, String(e.asset_type || '')) ? 1 : 0,
        tradeCash: 0,
        clearedCash: isCashTicker(ticker, String(e.asset_type || '')) ? money(Number(e.total_net_value ?? 0)) : 0,
        pendingCash: type === 'pending_settlement' ? money(Number(e.total_net_value ?? 0)) : 0,
        openPending: type === 'pending_settlement' ? money(Number(e.total_net_value ?? 0)) : 0,
        finding: `sem business_event_id (${type})`,
      });
    }

    return rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.eventId).localeCompare(String(b.eventId)));
  }

  private buildCashRows(
    events: LedgerEvent[],
    snapshot: BrokerCustodySnapshotRecord | null,
    asOf: string
  ) {
    const cash = buildCashInTransitSummary(events, asOf);
    const grossCash = cashBalanceFromLedger(events, asOf);
    const settled = settledCashBalanceFromLedger(events, asOf);
    const brokerCash = snapshot?.composition.cash ?? null;
    const brokerTransit = snapshot?.composition.inTransit ?? null;
    const fixedIncomeLedger = fixedIncomeTotalFromLedger(events);
    const brokerFixedIncome = snapshot?.composition.fixedIncome ?? null;
    const adjustmentEvents = events.filter((e) => /AJUSTE DE DIVERG/i.test(String(e.notes || '')));

    return [
      {
        id: 'cash-settled',
        status: brokerCash == null ? 'warn' : Math.abs(settled - brokerCash) <= 0.05 ? 'ok' : 'error',
        item: 'Saldo atual caixa',
        systemValue: money(settled),
        brokerValue: brokerCash == null ? null : money(brokerCash),
        delta: brokerCash == null ? null : money(settled - brokerCash),
        finding: brokerCash == null ? 'sem snapshot broker' : 'comparado com cash_balance do home broker',
      },
      {
        id: 'cash-transit',
        status: brokerTransit == null ? 'warn' : Math.abs(cash.inTransitNet - brokerTransit) <= 0.05 ? 'ok' : 'error',
        item: 'Saldo em transicao',
        systemValue: money(cash.inTransitNet),
        brokerValue: brokerTransit == null ? null : money(brokerTransit),
        delta: brokerTransit == null ? null : money(cash.inTransitNet - brokerTransit),
        finding: `${cash.lines.length} linha(s) em transito; caixa bruto ${money(grossCash)}`,
      },
      {
        id: 'fixed-income',
        status: brokerFixedIncome == null ? 'warn' : Math.abs(fixedIncomeLedger - brokerFixedIncome) <= 1 ? 'ok' : 'error',
        item: 'Renda fixa',
        systemValue: money(fixedIncomeLedger),
        brokerValue: brokerFixedIncome == null ? null : money(brokerFixedIncome),
        delta: brokerFixedIncome == null ? null : money(fixedIncomeLedger - brokerFixedIncome),
        finding: 'total do livro de RF contra total consolidado do home broker',
      },
      {
        id: 'cash-adjustments',
        status: adjustmentEvents.length ? 'error' : 'ok',
        item: 'Ajustes automaticos de caixa',
        systemValue: adjustmentEvents.length,
        brokerValue: 0,
        delta: adjustmentEvents.length,
        finding: adjustmentEvents.length
          ? 'existem ajustes de divergencia: reimportar/corrigir antes de confiar'
          : 'nenhum ajuste automatico encontrado',
      },
    ];
  }

  private async resolvePeriodOrNull(ctx: UserContext) {
    try {
      return await this.periods.resolveDefault(ctx);
    } catch (err) {
      if (err instanceof GatewayError && err.code === 'INVEST_BOOK_PERIOD_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  private buildDailyAuditRows(events: LedgerEvent[], asOf: string, openingDate: string | null): {
    financial: DailyFinancialAuditRow[];
    business: DailyBusinessAuditRow[];
    portfolio: DailyPortfolioAuditRow[];
  } {
    const sorted = [...events].sort((a, b) =>
      String(a.transaction_date).localeCompare(String(b.transaction_date)) ||
      (String(a.transaction_type) === 'revaluation' && String(b.transaction_type) !== 'revaluation'
        ? 1
        : String(a.transaction_type) !== 'revaluation' && String(b.transaction_type) === 'revaluation'
          ? -1
          : String(a.id ?? '').localeCompare(String(b.id ?? '')))
    );
    const firstDate =
      openingDate ||
      sorted.map((e) => String(e.transaction_date || '').slice(0, 10)).find(Boolean) ||
      asOf;
    const calendar = dateRange(firstDate, asOf);
    const byDate = new Map<string, LedgerEvent[]>();
    for (const e of sorted) {
      const d = String(e.transaction_date || '').slice(0, 10);
      if (!d) continue;
      byDate.set(d, [...(byDate.get(d) || []), e]);
    }

    const eventHasAsset = new Set<string>();
    for (const e of sorted) {
      if (String(e.transaction_type) === 'opening_balance') continue;
      if (!e.business_event_id) continue;
      const ticker = String(e.asset_ticker || '').toUpperCase();
      const assetType = String(e.asset_type || inferAssetType(ticker));
      if (!isCashTicker(ticker, assetType)) eventHasAsset.add(String(e.business_event_id));
    }

    let grossCash = 0;
    const pendingByRef = new Map<string, AuditPendingCashState>();
    const positions = new Map<string, AuditPositionState>();
    const financial: DailyFinancialAuditRow[] = [];
    const business: DailyBusinessAuditRow[] = [];
    const portfolio: DailyPortfolioAuditRow[] = [];

    const transitTotal = () => money([...pendingByRef.values()].reduce((sum, row) => sum + row.amount, 0));
    const portfolioTotal = () =>
      money(
        [...positions.values()].reduce((sum, p) => {
          if (Math.abs(p.qty) < 0.000001) return sum;
          return sum + p.qty * p.unitValue;
        }, 0)
      );
    const portfolioDetails = () =>
      detailList(
        [...positions.values()]
          .filter((p) => Math.abs(p.qty) >= 0.000001)
          .sort((a, b) => a.ticker.localeCompare(b.ticker))
          .map((p) => `${p.ticker}: ${round(p.qty)} x ${money(p.unitValue)} = ${money(p.qty * p.unitValue)}`),
        24
      );

    const applyLedgerEventToAuditState = (
      e: LedgerEvent,
      date: string,
      mode: 'opening' | 'movement',
      dayState?: {
        assetMovementValue: { value: number };
        pureFinancialValue: { value: number };
        transitChange: { value: number };
        assetDetails: string[];
        pureDetails: string[];
        transitDetails: string[];
        changedAssets: string[];
      }
    ) => {
      const ticker = String(e.asset_ticker || '').toUpperCase();
      const assetType = String(e.asset_type || inferAssetType(ticker));
      const txType = String(e.transaction_type);
      const isCash = isCashTicker(ticker, assetType);

      if (isCash) {
        const value = Number(e.total_net_value ?? 0);
        if (txType === 'pending_settlement') {
          const rawRef = String(e.broker_note_ref || e.id || `${date}-${dayState?.transitDetails.length ?? 0}`);
          if (!rawRef.startsWith(AUTO_D2_REF_PREFIX)) {
            grossCash += value;
            if (mode === 'movement' && dayState) {
              const linkedToAsset = Boolean(
                e.business_event_id && eventHasAsset.has(String(e.business_event_id))
              );
              if (linkedToAsset) {
                dayState.assetMovementValue.value += value;
                dayState.assetDetails.push(`${txType} ${ticker}: ${money(value)}`);
              } else {
                dayState.pureFinancialValue.value += value;
                dayState.pureDetails.push(`${txType} ${ticker}: ${money(value)}`);
              }
            }
            return;
          }
          const baseRef = rawRef.endsWith(':CLEAR') ? rawRef.slice(0, -':CLEAR'.length) : rawRef;
          if (rawRef.endsWith(':CLEAR')) {
            pendingByRef.delete(baseRef);
            if (mode === 'movement' && dayState) {
              dayState.transitDetails.push(`${rawRef}: baixa de transito`);
            }
            return;
          }
          const prev = pendingByRef.get(baseRef);
          pendingByRef.set(baseRef, {
            amount: money((prev?.amount ?? 0) + value),
            settleDate: prev?.settleDate ?? String(e.settlement_date || date).slice(0, 10),
          });
          if (mode === 'movement' && dayState) {
            dayState.transitChange.value += value;
            dayState.transitDetails.push(`${rawRef}: ${money(value)}`);
          }
          return;
        }

        grossCash += value;
        if (mode === 'movement' && dayState) {
          const linkedToAsset =
            Boolean(e.business_event_id && eventHasAsset.has(String(e.business_event_id))) ||
            isBusinessTrade(e);
          if (linkedToAsset) {
            dayState.assetMovementValue.value += value;
            dayState.assetDetails.push(`${txType} ${ticker}: ${money(value)}`);
          } else {
            dayState.pureFinancialValue.value += value;
            dayState.pureDetails.push(`${txType} ${ticker}: ${money(value)}`);
          }
        }
        return;
      }

      if (e.impacts_managerial_price === false || e.impacts_managerial_price === 0) return;
      const previous = positions.get(ticker) || {
        ticker,
        assetType,
        qty: 0,
        unitValue: Number(e.unit_price ?? 0),
      };
      const beforeValue = previous.qty * previous.unitValue;
      const unit = Number(e.unit_price ?? 0);
      const qtyDelta = assetQuantityDelta(e, previous.qty);
      const next: AuditPositionState = { ...previous };
      if (unit > 0) next.unitValue = unit;
      if (txType === 'split') {
        next.qty = Number(e.quantity ?? previous.qty);
      } else if (qtyDelta != null) {
        next.qty += qtyDelta;
      } else if (txType === 'revaluation' && unit > 0) {
        next.unitValue = unit;
      }
      positions.set(ticker, next);

      if (mode === 'movement' && dayState) {
        const afterValue = next.qty * next.unitValue;
        const deltaValue = money(afterValue - beforeValue);
        if (Math.abs(deltaValue) > 0.005 || qtyDelta != null || txType === 'split') {
          dayState.changedAssets.push(
            `${ticker} ${txType}: qtd ${round(previous.qty)} -> ${round(next.qty)}, valor ${money(beforeValue)} -> ${money(afterValue)}`
          );
        }
      }
    };

    for (const date of calendar) {
      const day = byDate.get(date) || [];
      for (const e of day) {
        if (String(e.transaction_type) === 'opening_balance') {
          applyLedgerEventToAuditState(e, date, 'opening');
        }
      }
      const openingTransit = transitTotal();
      const openingCash = money(grossCash - openingTransit);
      const openingPortfolioValue = portfolioTotal();
      const openingPatrimonyValue = money(openingCash + openingTransit + openingPortfolioValue);
      const assetMovementValue = { value: 0 };
      const pureFinancialValue = { value: 0 };
      const transitChange = { value: 0 };
      const assetDetails: string[] = [];
      const pureDetails: string[] = [];
      const transitDetails: string[] = [];
      const changedAssets: string[] = [];
      const businessGroups = new Map<string, LedgerEvent[]>();
      const unlinked: LedgerEvent[] = [];

      for (const e of day) {
        if (String(e.transaction_type) === 'opening_balance') continue;
        if (isPendingSettlementClear(e)) continue;
        if (e.business_event_id) {
          const id = String(e.business_event_id);
          businessGroups.set(id, [...(businessGroups.get(id) || []), e]);
        } else if (String(e.transaction_type) !== 'opening_balance') {
          unlinked.push(e);
        }
      }

      for (const e of day) {
        if (String(e.transaction_type) === 'opening_balance') continue;
        applyLedgerEventToAuditState(e, date, 'movement', {
          assetMovementValue,
          pureFinancialValue,
          transitChange,
          assetDetails,
          pureDetails,
          transitDetails,
          changedAssets,
        });
      }

      const closingCashSummary = buildCashInTransitSummary(sorted, date);
      const closingTransit = money(closingCashSummary.inTransitNet);
      const closingCash = money(closingCashSummary.settledCashBalance);
      const closingPortfolioValue = portfolioTotal();
      const closingPatrimonyValue = money(closingCash + closingTransit + closingPortfolioValue);
      const businessRow = this.buildDailyBusinessRow(date, businessGroups, unlinked);

      financial.push({
        id: `fin-${date}`,
        date,
        openingCash,
        openingTransit,
        assetMovementValue: money(assetMovementValue.value),
        pureFinancialValue: money(pureFinancialValue.value),
        transitChange: money(transitChange.value),
        closingTransit,
        closingCash,
        closingCashWithTransit: money(closingCash + closingTransit),
        assetDetails: detailList(assetDetails),
        pureFinancialDetails: detailList(pureDetails),
        transitDetails: detailList(transitDetails),
      });

      business.push(businessRow);

      portfolio.push({
        id: `port-${date}`,
        date,
        openingPatrimonyValue,
        openingPortfolioValue,
        assetMovementDelta: money(closingPortfolioValue - openingPortfolioValue),
        closingPortfolioValue,
        closingPatrimonyValue,
        totalPatrimonyFromSheets: closingPatrimonyValue,
        changedAssets: detailList(changedAssets, 16),
        consideredAssets: portfolioDetails(),
      });
    }

    return { financial, business, portfolio };
  }

  private buildDailyBusinessRow(
    date: string,
    groups: Map<string, LedgerEvent[]>,
    unlinked: LedgerEvent[]
  ): DailyBusinessAuditRow {
    let bothSidesEvents = 0;
    let financialOnlyEvents = 0;
    let assetOnlyEvents = 0;
    let linkedAssetExpectedCash = 0;
    let linkedFinancialCash = 0;
    let twoSidedExpectedCash = 0;
    let twoSidedFinancialCash = 0;
    const explanations: string[] = [];
    const unlinkedExplanation: string[] = [];

    for (const [eventId, legs] of groups) {
      const assetLegs = legs.filter((e) => {
        const ticker = String(e.asset_ticker || '').toUpperCase();
        return !isCashTicker(ticker, String(e.asset_type || ''));
      });
      const cashLegs = legs.filter((e) => {
        const ticker = String(e.asset_ticker || '').toUpperCase();
        return isCashTicker(ticker, String(e.asset_type || ''));
      });
      const hasAsset = assetLegs.length > 0;
      const hasCash = cashLegs.some((e) => Math.abs(dailyBusinessCashValue(e)) > 0.005);
      const expectedCash = money(assetLegs.filter(isBusinessTrade).reduce((sum, e) => sum + tradeSignedCash(e), 0));
      const actualCash = money(cashLegs.reduce((sum, e) => sum + dailyBusinessCashValue(e), 0));
      linkedAssetExpectedCash += expectedCash;
      linkedFinancialCash += actualCash;
      if (hasAsset && hasCash) {
        bothSidesEvents += 1;
        twoSidedExpectedCash += expectedCash;
        twoSidedFinancialCash += actualCash;
      } else if (hasCash) financialOnlyEvents += 1;
      else if (hasAsset) assetOnlyEvents += 1;
      const tickers = [...new Set(assetLegs.map((e) => String(e.asset_ticker || '').toUpperCase()))].join(',');
      const ops = [...new Set(legs.map((e) => String(e.transaction_type)))].join(',');
      explanations.push(
        `${eventId.slice(0, 8)} ${tickers || 'financeiro'} ${ops}: ativo ${money(expectedCash)}, caixa ${money(actualCash)}`
      );
    }

    for (const e of unlinked) {
      const ticker = String(e.asset_ticker || '').toUpperCase();
      const isCash = isCashTicker(ticker, String(e.asset_type || ''));
      unlinkedExplanation.push(
        `${isCash ? 'FIN' : 'ATIVO'} ${String(e.transaction_type)} ${ticker}: ${money(Number(e.total_net_value ?? 0))}`
      );
    }

    const eventCashDelta = money(twoSidedFinancialCash - twoSidedExpectedCash);
    let status: 'ok' | 'warn' | 'error' = 'ok';
    if (unlinked.length > 0 || Math.abs(eventCashDelta) > 0.05) status = 'error';
    else if (assetOnlyEvents > 0 || financialOnlyEvents > 0) status = 'warn';
    const findingParts: string[] = [];
    if (unlinked.length > 0) findingParts.push(`${unlinked.length} perna(s) sem business_event_id`);
    if (Math.abs(eventCashDelta) > 0.05) {
      findingParts.push(`delta entre ativo e financeiro: ${eventCashDelta}`);
    }
    if (assetOnlyEvents > 0) findingParts.push(`${assetOnlyEvents} evento(s) com ativo sem caixa no dia`);
    if (financialOnlyEvents > 0) findingParts.push(`${financialOnlyEvents} evento(s) financeiro(s) sem ativo no dia`);

    return {
      id: `biz-${date}`,
      date,
      status,
      finding: findingParts.join(' | ') || 'OK',
      businessEvents: groups.size,
      bothSidesEvents,
      financialOnlyEvents,
      assetOnlyEvents,
      missingBusinessEventCount: unlinked.length,
      linkedAssetExpectedCash: money(linkedAssetExpectedCash),
      linkedFinancialCash: money(linkedFinancialCash),
      eventCashDelta,
      businessExplanation: detailList(explanations, 18),
      unlinkedExplanation: detailList(unlinkedExplanation, 18),
    };
  }

  private async buildResetRows(ctx: UserContext) {
    const tables = [
      'invest_portfolio_daily',
      'invest_daily_snapshots',
      'invest_reconciliation_sessions',
      'invest_reconciliation_day_log',
      'invest_broker_custody_snapshots',
    ];
    const out = [];
    for (const table of tables) {
      const rows = await this.gateway.findWhere(ctx, table, { organization_id: ctx.organizationId }, { limit: 1000, columns: ['id'] });
      out.push({
        id: `reset-${table}`,
        status: 'ok',
        check: table,
        value: rows.length,
        finding: rows.length
          ? 'ha dados pos-reset/reimportacao; esperado depois de processar'
          : 'zerado ou ainda nao reimportado',
      });
    }
    return out;
  }

  private buildCriticalFindings(
    assetRows: Array<{ status: string; ticker: string; finding: string }>,
    eventRows: Array<{ status: string; date: string; tickers: string; finding: string }>,
    cashRows: Array<{ status: string; item: string; finding: string }>,
    resetRows: Array<{ status: string; check: string; finding: string }>
  ) {
    const out: Array<{ id: string; area: string; severity: string; finding: string }> = [];
    for (const r of assetRows) {
      if (r.status === 'error' || r.status === 'missing_broker') {
        out.push({ id: `asset-${r.ticker}`, area: 'Ativos', severity: 'error', finding: `${r.ticker}: ${r.finding}` });
      }
    }
    for (const r of eventRows) {
      if (r.status === 'error') {
        out.push({ id: `event-${out.length}`, area: 'Eventos', severity: 'error', finding: `${r.date} ${r.tickers}: ${r.finding}` });
      }
    }
    for (const r of cashRows) {
      if (r.status === 'error') {
        out.push({ id: `cash-${r.item}`, area: 'Financeiro', severity: 'error', finding: `${r.item}: ${r.finding}` });
      }
    }
    for (const r of resetRows) {
      if (r.status === 'error') {
        out.push({ id: `reset-${r.check}`, area: 'Reset', severity: 'error', finding: `${r.check}: ${r.finding}` });
      }
    }
    return out.slice(0, 100);
  }
}
