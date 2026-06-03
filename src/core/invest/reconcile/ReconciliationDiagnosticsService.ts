import { CoCeoDataGateway, type UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import { BrokerCustodySnapshotRepository } from '../BrokerCustodySnapshotRepository';
import type { BrokerCustodySnapshotRecord } from '../brokerCustodySnapshotTypes';
import { rebuildCustodyFromLedger, type LedgerEvent } from '../CustodyEngine';
import { inferAssetType, inferUnderlyingTicker, isFixedIncomeTicker, isOptionTicker } from '../assetClassifier';
import { LedgerImportService } from '../LedgerImportService';
import { computeThreePricesByUnderlying } from '../threePricesEngine';
import { buildCashInTransitSummary } from '../cashInTransit';
import { cashBalanceFromLedger, settledCashBalanceFromLedger } from '../cashInvestLedger';
import { fixedIncomeTotalFromLedger } from '../patrimonyLedgerGates';

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

export class ReconciliationDiagnosticsService {
  private readonly ledger: LedgerImportService;
  private readonly snapshots: BrokerCustodySnapshotRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    this.snapshots = new BrokerCustodySnapshotRepository(gateway);
  }

  async build(ctx: UserContext, asOfInput?: string) {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Personifique a holding para conferir a conciliacao.', 400);
    }

    const latestSnapshot = await this.snapshots.loadLatest(ctx).catch(() => null);
    const asOf = (asOfInput || latestSnapshot?.referenceDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', asOf);
    const custody = rebuildCustodyFromLedger(events);
    const threePrices = computeThreePricesByUnderlying(events);
    const stored = await this.loadStoredPositions(ctx);
    const broker = this.aggregateBroker(latestSnapshot);

    const assetRows = this.buildAssetRows(
      custody.assets,
      stored,
      broker,
      threePrices,
      Boolean(latestSnapshot)
    );
    const eventRows = this.buildBusinessEventRows(events);
    const cashRows = this.buildCashRows(events, latestSnapshot, asOf);
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
      const isEquity = assetType === 'stock' || assetType === 'fii';
      if (isEquity && (!prices || prices.qty <= 0 || prices.estrito <= 0)) {
        status = 'error';
        notes.push('3 precos ausentes/zerados para acao com posicao');
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
