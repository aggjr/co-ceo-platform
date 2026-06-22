import type mysql from 'mysql2/promise';
import type { CoCeoDataGateway, UserContext } from '../dal';
import { isMissingSchemaError } from '../dal/mysqlErrors';
import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';
import { buildDailyPatrimonyMtmSeries } from './PatrimonyMtmDailyEngine';
import { buildCashInTransitSummary } from './cashInTransit';
import {
  cashBalanceFromLedger,
  cashLedgerEventsForBalance,
  isCashInvestTicker,
} from './cashInvestLedger';
import { fixedIncomeTotalFromLedger } from './patrimonyLedgerGates';
import { loadOptionMarketCatalog } from './optionMarketCatalog';
import type { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import type { LedgerImportService } from './LedgerImportService';
import type { AssetValuationContext } from './valuation/AssetValuationContext';
import type { FxRateRepository } from '../market/FxRateRepository';
import {
  buildGeneralAuditDayEventsByDate,
  type GeneralAuditDayEvents,
} from './generalAuditDayEvents';

function enumerateIsoDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export type GeneralAuditColumn = {
  key: string;
  label: string;
  kind: 'patrimony' | 'cash' | 'transit' | 'qty' | 'value' | 'count' | 'text' | 'status';
  ticker?: string;
  assetType?: string;
  sticky?: boolean;
};

export type GeneralAuditCell = {
  value: number | null;
  text?: string | null;
  changed: boolean;
};

export type GeneralAuditRow = {
  date: string;
  cells: Record<string, GeneralAuditCell>;
};

export type GeneralAuditMatrixResult = {
  from: string;
  to: string;
  businessDays: number;
  columns: GeneralAuditColumn[];
  rows: GeneralAuditRow[];
  tickers: string[];
  dataSource: 'position_daily' | 'ledger_replay' | 'mixed';
};

function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

function businessDaysBetween(from: string, to: string): string[] {
  return enumerateIsoDates(from, to).filter(isWeekday);
}

function roundMoney(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r) < 0.005 ? 0 : r;
}

function roundQty(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function assetTypeRank(assetType: string): number {
  const t = assetType.toLowerCase();
  if (t === 'stock' || t === 'fii') return 1;
  if (t === 'fixed_income' || t === 'cdb') return 2;
  if (t === 'option_call') return 3;
  if (t === 'option_put') return 4;
  return 5;
}

function sortTickers(
  tickers: Iterable<string>,
  meta: Map<string, { assetType: string }>
): string[] {
  return [...tickers].sort((a, b) => {
    const ra = assetTypeRank(meta.get(a)?.assetType ?? '');
    const rb = assetTypeRank(meta.get(b)?.assetType ?? '');
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function cellChanged(
  prev: number | null,
  curr: number | null,
  kind: 'qty' | 'money'
): boolean {
  if (prev == null) return false;
  const tol = kind === 'qty' ? 1e-6 : 0.01;
  return Math.abs((curr ?? 0) - (prev ?? 0)) > tol;
}

type PositionDayRow = {
  ticker: string;
  assetType: string;
  quantity: number;
  marketValue: number;
};

function positionsFromLedger(
  events: LedgerEvent[],
  asOf: string,
  quoteForDate?: (ticker: string, date: string) => number | undefined
): PositionDayRow[] {
  const slice = events.filter((e) => {
    const d = String(e.transaction_date || '').slice(0, 10);
    return d && d <= asOf;
  });
  const { assets } = rebuildCustodyFromLedger(slice);
  const out: PositionDayRow[] = [];
  for (const a of assets) {
    if (isCashInvestTicker(a.ticker)) continue;
    const qty = Number(a.quantity);
    if (Math.abs(qty) < 1e-9) continue;
    const quote =
      quoteForDate?.(a.ticker.toUpperCase(), asOf) ??
      (Number(a.avgPrice) > 0 ? Number(a.avgPrice) : 0);
    const mv = roundMoney(Math.abs(qty) * Math.max(0, quote));
    out.push({
      ticker: a.ticker.toUpperCase(),
      assetType: String(a.assetType || 'stock'),
      quantity: roundQty(qty),
      marketValue: mv,
    });
  }
  return out;
}

function textChanged(prev: string | null | undefined, curr: string): boolean {
  const p = String(prev ?? '').trim();
  const c = String(curr ?? '').trim();
  if (p === c) return false;
  return p !== '' || c !== '';
}

function buildEventColumns(): GeneralAuditColumn[] {
  return [
    { key: 'events_count', label: 'Evt.', kind: 'count' },
    { key: 'events_status', label: 'Status evt.', kind: 'status' },
    { key: 'events_notes', label: 'Notas corretagem', kind: 'text' },
    { key: 'events_extract', label: 'Extrato CC', kind: 'text' },
    { key: 'events_business', label: 'Negócios (BE)', kind: 'text' },
    { key: 'events_cash_asset', label: 'Caixa ↔ ativo', kind: 'text' },
    { key: 'events_cash_pure', label: 'Caixa puro', kind: 'text' },
    { key: 'events_transit_mov', label: 'Mov. trânsito', kind: 'text' },
    { key: 'events_orphans', label: 'Sem vínculo', kind: 'text' },
  ];
}

function buildColumns(tickers: string[], meta: Map<string, { assetType: string }>): GeneralAuditColumn[] {
  const cols: GeneralAuditColumn[] = [
    { key: 'date', label: 'Data', kind: 'text', sticky: true },
    { key: 'patrimony', label: 'Patrimônio', kind: 'patrimony', sticky: true },
    { key: 'cash_settled', label: 'Conta corrente', kind: 'cash', sticky: true },
    { key: 'cash_transit', label: 'Em trânsito', kind: 'transit', sticky: true },
    ...buildEventColumns(),
  ];
  for (const ticker of tickers) {
    const short = ticker.length > 12 ? `${ticker.slice(0, 10)}…` : ticker;
    cols.push({
      key: `${ticker}__qty`,
      label: `${short} qtd`,
      kind: 'qty',
      ticker,
      assetType: meta.get(ticker)?.assetType,
    });
    cols.push({
      key: `${ticker}__mv`,
      label: `${short} VM`,
      kind: 'value',
      ticker,
      assetType: meta.get(ticker)?.assetType,
    });
  }
  return cols;
}

export async function buildGeneralAuditMatrix(input: {
  ctx: UserContext;
  from: string;
  to: string;
  periodMin: string;
  gateway: CoCeoDataGateway;
  ledger: LedgerImportService;
  marketQuoteRepo: MarketQuoteRepository;
  valuationContext: AssetValuationContext;
  fxRates: FxRateRepository;
  pool: mysql.Pool;
}): Promise<GeneralAuditMatrixResult> {
  const { ctx, from, to, periodMin, gateway, ledger, marketQuoteRepo, valuationContext, fxRates, pool } =
    input;
  const orgId = ctx.organizationId!;
  const events = await ledger.listLedgerEvents(ctx, periodMin, to);
  const days = businessDaysBetween(from, to);

  const quoteMap = await marketQuoteRepo.loadQuoteMapForRange(ctx, from, to);
  const quoteForDate =
    quoteMap.size > 0 ? marketQuoteRepo.buildQuoteForDateFn(quoteMap) : undefined;

  const fixedIncomeTotal = fixedIncomeTotalFromLedger(events);
  const optionCatalog = await loadOptionMarketCatalog(gateway, orgId);
  const valuationSnapshot = await valuationContext.load(ctx);
  const fxByPairDate = new Map<string, number>();
  const foreignCurrencies = [
    ...new Set([...valuationSnapshot.currencyByType.values()].filter((c) => c !== 'BRL')),
  ];
  if (foreignCurrencies.length) {
    for (const date of enumerateIsoDates(from, to)) {
      for (const currency of foreignCurrencies) {
        const rate = await fxRates.getClosingRate(currency, 'BRL', date).catch(() => null);
        if (rate != null && Number.isFinite(rate) && rate > 0) {
          fxByPairDate.set(`${currency}/BRL/${date}`, rate);
        }
      }
    }
  }

  const mtm = buildDailyPatrimonyMtmSeries(events, from, to, {
    stockQuotes: {},
    fixedIncomeTotal,
    calibrateToAnchors: false,
    quoteForDate,
    valuationContext: valuationSnapshot,
    optionContractForTicker: (ticker: string) => {
      const row = optionCatalog.get(ticker.toUpperCase());
      return row
        ? {
            underlyingTicker: row.underlyingTicker,
            optionType: row.optionType,
            strikePrice: row.strikePrice,
            expirationDate: row.expirationDate,
          }
        : undefined;
    },
    fxRateForDate: (fromCurrency, toCurrency, date) =>
      fxByPairDate.get(`${fromCurrency.toUpperCase()}/${toCurrency.toUpperCase()}/${date.slice(0, 10)}`),
  });

  const seriesByDate = new Map(mtm.series.map((p) => [String(p.date).slice(0, 10), p]));

  const storedByDate = new Map<string, PositionDayRow[]>();
  let storedDays = 0;
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT snapshot_date, ticker, asset_type, quantity, total_value
       FROM invest_position_daily
       WHERE organization_id = ?
         AND snapshot_date BETWEEN ? AND ?
       ORDER BY snapshot_date, ticker`,
      [orgId, from, to]
    );
    for (const row of rows) {
      const date =
        row.snapshot_date instanceof Date
          ? row.snapshot_date.toISOString().slice(0, 10)
          : String(row.snapshot_date).slice(0, 10);
      const ticker = String(row.ticker || '').toUpperCase();
      if (!ticker || isCashInvestTicker(ticker)) continue;
      const list = storedByDate.get(date) ?? [];
      list.push({
        ticker,
        assetType: String(row.asset_type || 'stock'),
        quantity: roundQty(Number(row.quantity)),
        marketValue: roundMoney(Number(row.total_value)),
      });
      storedByDate.set(date, list);
      storedDays += 1;
    }
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }

  const tickerMeta = new Map<string, { assetType: string }>();
  const allTickers = new Set<string>();

  for (const day of days) {
    const positions =
      storedByDate.get(day)?.length
        ? storedByDate.get(day)!
        : positionsFromLedger(events, day, quoteForDate);
    for (const p of positions) {
      allTickers.add(p.ticker);
      tickerMeta.set(p.ticker, { assetType: p.assetType });
    }
  }

  const tickers = sortTickers(allTickers, tickerMeta);
  const columns = buildColumns(tickers, tickerMeta);
  const eventsByDate = buildGeneralAuditDayEventsByDate(events, days);

  const prevValues = new Map<string, number | null>();
  const prevTexts = new Map<string, string>();
  const rows: GeneralAuditRow[] = [];

  const applyEventCells = (
    cells: Record<string, GeneralAuditCell>,
    ev: GeneralAuditDayEvents
  ) => {
    const eventFields: Array<{ key: string; text?: string; value?: number; kind: 'count' | 'text' | 'status' }> = [
      { key: 'events_count', value: ev.eventCount, kind: 'count' },
      { key: 'events_status', text: ev.statusLabel, kind: 'status' },
      { key: 'events_notes', text: ev.notesSummary, kind: 'text' },
      { key: 'events_extract', text: ev.extractSummary, kind: 'text' },
      { key: 'events_business', text: ev.businessSummary, kind: 'text' },
      { key: 'events_cash_asset', text: ev.cashAssetSummary, kind: 'text' },
      { key: 'events_cash_pure', text: ev.cashPureSummary, kind: 'text' },
      { key: 'events_transit_mov', text: ev.transitSummary, kind: 'text' },
      { key: 'events_orphans', text: ev.orphanSummary, kind: 'text' },
    ];

    for (const field of eventFields) {
      if (field.kind === 'count') {
        const value = field.value ?? 0;
        const prev = prevValues.get(field.key) ?? null;
        cells[field.key] = { value, changed: cellChanged(prev, value, 'qty') };
        prevValues.set(field.key, value);
      } else {
        const text = field.text ?? '';
        const prev = prevTexts.get(field.key) ?? null;
        cells[field.key] = { value: null, text, changed: textChanged(prev, text) };
        prevTexts.set(field.key, text);
      }
    }
  };

  for (const day of days) {
    const point = seriesByDate.get(day);
    const cashEvents = cashLedgerEventsForBalance(events);
    const cashSettled = roundMoney(cashBalanceFromLedger(cashEvents, day));
    const transit = roundMoney(buildCashInTransitSummary(cashEvents, day).inTransitNet);
    const patrimony = roundMoney(
      Number(point?.patrimony ?? cashSettled + transit)
    );

    const positions =
      storedByDate.get(day)?.length
        ? storedByDate.get(day)!
        : positionsFromLedger(events, day, quoteForDate);
    const posByTicker = new Map(positions.map((p) => [p.ticker, p]));

    const cells: Record<string, GeneralAuditCell> = {};

    const core: Array<{ key: string; value: number; kind: 'money' | 'qty' }> = [
      { key: 'patrimony', value: patrimony, kind: 'money' },
      { key: 'cash_settled', value: cashSettled, kind: 'money' },
      { key: 'cash_transit', value: transit, kind: 'money' },
    ];

    for (const { key, value, kind } of core) {
      const prev = prevValues.get(key) ?? null;
      cells[key] = { value, changed: cellChanged(prev, value, kind) };
      prevValues.set(key, value);
    }

    for (const ticker of tickers) {
      const pos = posByTicker.get(ticker);
      const qty = pos ? pos.quantity : 0;
      const mv = pos ? pos.marketValue : 0;
      const qtyKey = `${ticker}__qty`;
      const mvKey = `${ticker}__mv`;
      const prevQty = prevValues.get(qtyKey) ?? null;
      const prevMv = prevValues.get(mvKey) ?? null;
      cells[qtyKey] = { value: qty, changed: cellChanged(prevQty, qty, 'qty') };
      cells[mvKey] = { value: mv, changed: cellChanged(prevMv, mv, 'money') };
      prevValues.set(qtyKey, qty);
      prevValues.set(mvKey, mv);
    }

    applyEventCells(cells, eventsByDate.get(day)!);

    rows.push({ date: day, cells });
  }

  let dataSource: GeneralAuditMatrixResult['dataSource'] = 'ledger_replay';
  if (storedDays > 0 && storedByDate.size >= days.length * 0.5) {
    dataSource = storedByDate.size === days.length ? 'position_daily' : 'mixed';
  }

  return {
    from,
    to,
    businessDays: days.length,
    columns,
    rows,
    tickers,
    dataSource,
  };
}
