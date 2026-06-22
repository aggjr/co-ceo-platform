/**
 * Matriz diaria holding — uma linha por dia util (seg-sex) com caixa EOD,
 * posicoes, buckets de movimento e flags de auditoria.
 *
 *   npx ts-node scripts/audit-holding-daily-matrix.ts --from=2026-01-01 --to=2026-06-17
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';
import { rebuildCustodyFromLedger } from '../src/core/invest/CustodyEngine';
import { MAIN_CASH_TICKER } from '../src/core/invest/ledgerTypes';
import {
  cashLedgerEventsForBalance,
  isCashInvestTicker,
} from '../src/core/invest/cashInvestLedger';
import { buildCashInTransitSummary } from '../src/core/invest/cashInTransit';
import { isTesouroDiretoTicker } from '../src/core/invest/tesouroDirectLedger';
import { isOptionTicker } from '../src/core/invest/assetClassifier';
import { createInvestPool } from './lib/invest-db-pool';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

type MovementBuckets = {
  pat_stock_buy_qty: number;
  pat_stock_sell_qty: number;
  pat_lft_buy_qty: number;
  pat_lft_sell_qty: number;
  pat_opt_short_open: number;
  pat_opt_short_close: number;
  fin_liq_bolsa: number;
  fin_pending_note: number;
  fin_dividend: number;
  fin_cash_yield: number;
  fin_fee: number;
  fin_other: number;
};

type DayRow = MovementBuckets & {
  date: string;
  cash_cleared_eod: number;
  cash_pending_eod: number;
  lft_qty_eod: number;
  stock_positions: number;
  option_positions: number;
  option_symbols_open: string;
  events_count: number;
  orphan_count: number;
  issues: string;
};

function parseArg(name: string, fallback: string): string {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

function businessDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    if (isWeekday(iso)) out.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function emptyBuckets(): MovementBuckets {
  return {
    pat_stock_buy_qty: 0,
    pat_stock_sell_qty: 0,
    pat_lft_buy_qty: 0,
    pat_lft_sell_qty: 0,
    pat_opt_short_open: 0,
    pat_opt_short_close: 0,
    fin_liq_bolsa: 0,
    fin_pending_note: 0,
    fin_dividend: 0,
    fin_cash_yield: 0,
    fin_fee: 0,
    fin_other: 0,
  };
}

function isMainCashEvent(e: LedgerEvent): boolean {
  return String(e.asset_ticker || '').toUpperCase() === MAIN_CASH_TICKER;
}

function isPatEvent(e: LedgerEvent): boolean {
  if (String(e.asset_type) === 'cash') return false;
  if (isCashInvestTicker(String(e.asset_ticker))) return false;
  return true;
}

function isLftAsset(e: LedgerEvent): boolean {
  return (
    String(e.asset_type) === 'fixed_income' || isTesouroDiretoTicker(String(e.asset_ticker))
  );
}

function isStockAsset(e: LedgerEvent): boolean {
  const t = String(e.asset_type);
  return t === 'stock' || t === 'fii';
}

function isOptionAsset(e: LedgerEvent): boolean {
  const t = String(e.asset_type);
  return t === 'option_call' || t === 'option_put' || isOptionTicker(String(e.asset_ticker));
}

function classifyPatMovement(e: LedgerEvent, b: MovementBuckets): void {
  const type = String(e.transaction_type);
  const qty = Math.abs(Number(e.quantity ?? 0));
  if (qty < 1e-9 && type !== 'cost_adjustment') return;

  if (isStockAsset(e)) {
    if (type === 'buy' || (type === 'opening_balance' && Number(e.quantity) > 0)) {
      b.pat_stock_buy_qty += qty;
    } else if (type === 'sell') {
      b.pat_stock_sell_qty += qty;
    }
    return;
  }

  if (isLftAsset(e)) {
    if (type === 'buy' || (type === 'opening_balance' && Number(e.quantity) > 0)) {
      b.pat_lft_buy_qty += qty;
    } else if (type === 'sell') {
      b.pat_lft_sell_qty += qty;
    }
    return;
  }

  if (isOptionAsset(e)) {
    if (type === 'call_sell' || type === 'put_sell') {
      b.pat_opt_short_open += qty;
    } else if (type === 'call_buy' || type === 'put_buy') {
      b.pat_opt_short_close += qty;
    }
  }
}

function classifyFinMovement(e: LedgerEvent, b: MovementBuckets): void {
  const type = String(e.transaction_type);
  const net = Number(e.total_net_value ?? 0);
  const notes = String(e.notes || '');

  if (type === 'pending_settlement') {
    b.fin_pending_note += net;
    return;
  }
  if (type === 'dividend' || type === 'jcp') {
    b.fin_dividend += net;
    return;
  }
  if (type === 'cash_yield') {
    b.fin_cash_yield += net;
    return;
  }
  if (type === 'fee' || type === 'cost_adjustment' || type === 'penalty_b3') {
    b.fin_fee += net;
    return;
  }
  if (/LIQ\s+BOLSA/i.test(notes)) {
    b.fin_liq_bolsa += net;
    return;
  }
  b.fin_other += net;
}

function mainCashClearedEod(events: LedgerEvent[], asOf: string): number {
  let sum = 0;
  for (const e of cashLedgerEventsForBalance(events)) {
    if (!isMainCashEvent(e)) continue;
    const d = String(e.transaction_date || '').slice(0, 10);
    if (d && d > asOf) continue;
    if (String(e.transaction_type) === 'pending_settlement') continue;
    sum += Number(e.total_net_value ?? 0);
  }
  return round2(sum);
}

function mainCashPendingEod(events: LedgerEvent[], asOf: string): number {
  const transit = buildCashInTransitSummary(
    events.filter((e) => isMainCashEvent(e) || isCashInvestTicker(String(e.asset_ticker))),
    asOf
  );
  return round2(transit.inTransitNet);
}

function custodySnapshot(events: LedgerEvent[], asOf: string) {
  const slice = events.filter((e) => {
    const d = String(e.transaction_date || '').slice(0, 10);
    return d && d <= asOf;
  });
  const { assets } = rebuildCustodyFromLedger(slice);
  let lftQty = 0;
  let stockCount = 0;
  let optionCount = 0;
  const optionSymbols: string[] = [];

  for (const a of assets) {
    if (a.assetType === 'cash' || isCashInvestTicker(a.ticker)) continue;
    const qty = Number(a.quantity);
    if (Math.abs(qty) < 1e-9) continue;

    if (isTesouroDiretoTicker(a.ticker) || a.assetType === 'fixed_income') {
      lftQty += qty;
      continue;
    }
    if (a.assetType === 'stock' || a.assetType === 'fii') {
      stockCount += 1;
      continue;
    }
    if (a.assetType === 'option_call' || a.assetType === 'option_put' || isOptionTicker(a.ticker)) {
      optionCount += 1;
      optionSymbols.push(`${a.ticker}:${qty}`);
    }
  }

  return {
    lft_qty_eod: round2(lftQty),
    stock_positions: stockCount,
    option_positions: optionCount,
    option_symbols_open: optionSymbols.sort().join('|'),
  };
}

function buildIssues(row: DayRow): string[] {
  const flags: string[] = [];
  if (row.orphan_count > 0) flags.push('orphan');
  const lftPat = row.pat_lft_buy_qty + row.pat_lft_sell_qty;
  const lftFin = Math.abs(row.fin_liq_bolsa) + Math.abs(row.fin_fee) + Math.abs(row.fin_other);
  if (lftPat > 0 && lftFin < 0.01) flags.push('lft_no_fin');
  if (Math.abs(row.cash_cleared_eod) > 50_000_000 || row.cash_cleared_eod < -5000) {
    flags.push('cash_extreme');
  }
  return flags;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_COLUMNS: (keyof DayRow)[] = [
  'date',
  'cash_cleared_eod',
  'cash_pending_eod',
  'lft_qty_eod',
  'stock_positions',
  'option_positions',
  'option_symbols_open',
  'pat_stock_buy_qty',
  'pat_stock_sell_qty',
  'pat_lft_buy_qty',
  'pat_lft_sell_qty',
  'pat_opt_short_open',
  'pat_opt_short_close',
  'fin_liq_bolsa',
  'fin_pending_note',
  'fin_dividend',
  'fin_cash_yield',
  'fin_fee',
  'fin_other',
  'events_count',
  'orphan_count',
  'issues',
];

async function main() {
  const from = parseArg('from', '2026-01-01');
  const to = parseArg('to', '2026-06-17');

  const pool = createInvestPool();
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);

  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', to);

  const days = businessDays(from, to);
  const rows: DayRow[] = [];

  for (const day of days) {
    const dayEvents = events.filter((e) => String(e.transaction_date || '').slice(0, 10) === day);
    const buckets = emptyBuckets();
    let orphanCount = 0;

    for (const e of dayEvents) {
      if (!e.business_event_id) orphanCount += 1;
      if (isPatEvent(e)) classifyPatMovement(e, buckets);
      else if (isMainCashEvent(e)) classifyFinMovement(e, buckets);
    }

    const snap = custodySnapshot(events, day);
    const row: DayRow = {
      date: day,
      cash_cleared_eod: mainCashClearedEod(events, day),
      cash_pending_eod: mainCashPendingEod(events, day),
      ...snap,
      ...buckets,
      events_count: dayEvents.length,
      orphan_count: orphanCount,
      issues: '',
    };
    row.issues = buildIssues(row).join(';');
    rows.push(row);
  }

  const [optItems] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT identifier, quantity, subcategory
     FROM patrimony_items
     WHERE organization_id = ? AND deleted_at IS NULL
       AND subcategory IN ('option_call','option_put')
       AND ABS(quantity) > 0.0001
     ORDER BY identifier`,
    [ORG]
  );

  const patEvents = events.filter(isPatEvent);
  const finEvents = events.filter(isMainCashEvent);

  const reportsDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const base = `holding_daily_matrix_${from}_${to}`;
  const csvPath = path.join(reportsDir, `${base}.csv`);
  const jsonPath = path.join(reportsDir, `${base}.json`);

  const header = CSV_COLUMNS.join(';');
  const csvLines = [header, ...rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c])).join(';'))];
  fs.writeFileSync(csvPath, csvLines.join('\n'), { encoding: 'utf8' });

  const payload = {
    organization_id: ORG,
    from,
    to,
    business_days: rows.length,
    patrimony_events_in_range: patEvents.filter((e) => {
      const d = String(e.transaction_date || '').slice(0, 10);
      return d >= from && d <= to;
    }).length,
    financial_events_in_range: finEvents.filter((e) => {
      const d = String(e.transaction_date || '').slice(0, 10);
      return d >= from && d <= to;
    }).length,
    last_day: rows.length ? rows[rows.length - 1] : null,
    patrimony_items_options_eod: optItems.map((r) => ({
      identifier: String(r.identifier),
      quantity: Number(r.quantity),
      subcategory: String(r.subcategory),
    })),
    rows,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), { encoding: 'utf8' });

  const last = rows[rows.length - 1];
  const issueDays = rows.filter((r) => r.issues.length > 0);
  const topIssueDays = [...issueDays]
    .sort((a, b) => b.orphan_count - a.orphan_count || b.events_count - a.events_count)
    .slice(0, 5);

  console.log('=== holding daily matrix ===');
  console.log(`Org: ${ORG} | ${from} -> ${to} | dias uteis: ${rows.length}`);
  console.log(`Eventos patrimonio (periodo): ${payload.patrimony_events_in_range}`);
  console.log(`Eventos financeiros CAIXA-BTG (periodo): ${payload.financial_events_in_range}`);
  if (last) {
    console.log(
      `Caixa EOD ${last.date}: cleared=${last.cash_cleared_eod} pending=${last.cash_pending_eod}`
    );
    console.log(
      `Posicoes EOD: LFT qty=${last.lft_qty_eod} stocks=${last.stock_positions} options=${last.option_positions}`
    );
  }
  console.log(`Opcoes em patrimony_items (fim): ${optItems.length}`);
  console.log(`Dias com issues: ${issueDays.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log('\n--- Top 5 dias com issues ---');
  for (const d of topIssueDays) {
    console.log(`  ${d.date} events=${d.events_count} orphan=${d.orphan_count} [${d.issues}]`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
