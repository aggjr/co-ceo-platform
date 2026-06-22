/**
 * Auditoria Geral completa — matriz diária + validação de eventos + LFT.
 *
 *   npx ts-node scripts/audit-general-matrix-full.ts
 *   npx ts-node scripts/audit-general-matrix-full.ts --from=2026-01-01 --to=2026-06-18
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildGeneralAuditMatrix } from '../src/core/invest/GeneralAuditMatrixService';
import { summarizeGeneralAuditDayEvents } from '../src/core/invest/generalAuditDayEvents';
import { rebuildCustodyFromLedger } from '../src/core/invest/CustodyEngine';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';
import { resolveInvestPeriodBounds } from '../src/core/invest/investPeriodBounds';
import { isTesouroDiretoTicker } from '../src/core/invest/tesouroDirectLedger';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';
import { AssetValuationContext } from '../src/core/invest/valuation/AssetValuationContext';
import { FxRateRepository } from '../src/core/market/FxRateRepository';
import { BTG_MONTHS_2026, extractsDir } from './lib/btg-2026-months';
import { createInvestPool } from './lib/invest-db-pool';
import { loadSnapshotFromDados } from './lib/patrimony-dados-json';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const LFT_TICKER = 'LFT-20310301';
const TD_RE = /^(COMPRA|VENDA)\s+DEFINITIVA\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i;

function parseArg(name: string, fallback: string): string {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return fallback;
}

function br(raw: string): number {
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s);
}

function iso(brDate: string): string {
  const m = brDate.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return '';
  const yy = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${yy}-${m[2]}-${m[1]}`;
}

function roundQty(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function isWeekday(isoDate: string): boolean {
  const d = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

function lftQtyEod(events: LedgerEvent[], asOf: string): number {
  const slice = events.filter((e) => String(e.transaction_date || '').slice(0, 10) <= asOf);
  const { assets } = rebuildCustodyFromLedger(slice);
  const hit = assets.find(
    (a) => isTesouroDiretoTicker(a.ticker) || String(a.assetType) === 'fixed_income'
  );
  return hit ? roundQty(Number(hit.quantity)) : 0;
}

function lftDayMovement(events: LedgerEvent[], day: string) {
  const dayEv = events.filter(
    (e) =>
      String(e.transaction_date || '').slice(0, 10) === day &&
      String(e.asset_ticker || '').toUpperCase().includes('LFT')
  );
  let buyQty = 0;
  let sellQty = 0;
  const lines: string[] = [];
  for (const e of dayEv) {
    const qty = Number(e.quantity ?? 0);
    if (qty > 0) buyQty += qty;
    else if (qty < 0) sellQty += Math.abs(qty);
    lines.push(
      `${e.transaction_type} qty=${qty} net=${Number(e.total_net_value ?? 0).toFixed(2)} ref=${e.broker_note_ref || ''}`
    );
  }
  return { buyQty: roundQty(buyQty), sellQty: roundQty(sellQty), lines, count: dayEv.length };
}

async function loadTdTableFromExtracts(): Promise<
  Array<{ date: string; op: 'buy' | 'sell'; qty: number; gross: number; month: string }>
> {
  const out: Array<{ date: string; op: 'buy' | 'sell'; qty: number; gross: number; month: string }> =
    [];
  const ext = extractsDir();
  for (const spec of BTG_MONTHS_2026) {
    const txt = path.join(ext, spec.extractFile.replace(/\.pdf$/i, '.txt'));
    const pdf = path.join(ext, spec.extractFile);
    const source = fs.existsSync(txt) ? txt : pdf;
    if (!fs.existsSync(source)) continue;
    const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/);
    let d = '';
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const sd = line.match(/^(\d{2}\/\d{2}\/\d{2,4})\b/);
      if (sd) d = iso(sd[1]!);
      const fd = line.match(/^(\d{2}\/\d{2}\/\d{4})\b/);
      if (fd) d = iso(fd[1]!);
      const mv = line.match(TD_RE);
      if (!mv || !d) continue;
      out.push({
        month: spec.month,
        date: d,
        op: mv[1]!.toUpperCase() === 'COMPRA' ? 'buy' : 'sell',
        qty: Math.abs(br(mv[2]!)),
        gross: Math.abs(br(mv[4]!)),
      });
    }
  }
  return out;
}

function cellText(row: { cells: Record<string, { text?: string | null; value?: number | null }> }, key: string): string {
  const c = row.cells[key];
  if (!c) return '';
  if (c.text != null && String(c.text).trim()) return String(c.text);
  if (c.value != null && Number.isFinite(Number(c.value))) return String(c.value);
  return '';
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const pool = createInvestPool();
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const marketQuoteRepo = new MarketQuoteRepository(gateway);
  const valuationContext = new AssetValuationContext(gateway);
  const fxRates = new FxRateRepository(gateway);

  const allEvents = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const bounds = resolveInvestPeriodBounds(allEvents);
  const from = parseArg('from', bounds.defaultFrom);
  const to = parseArg('to', bounds.today > today ? today : bounds.today);

  console.log(`Montando matriz ${from} -> ${to} (org ${ORG})...`);
  const matrix = await buildGeneralAuditMatrix({
    ctx,
    from,
    to,
    periodMin: bounds.periodMin,
    gateway,
    ledger,
    marketQuoteRepo,
    valuationContext,
    fxRates,
    pool,
  });

  const lftEvents = allEvents.filter((e) => String(e.asset_ticker || '').toUpperCase().includes('LFT'));
  const lftBuys = lftEvents.filter(
    (e) => Number(e.quantity) > 0 && String(e.transaction_type) !== 'opening_balance'
  );
  const lftSells = lftEvents.filter((e) => Number(e.quantity) < 0);
  const openingLft = roundQty(
    lftEvents
      .filter((e) => String(e.transaction_type) === 'opening_balance')
      .reduce((s, e) => s + Number(e.quantity), 0)
  );
  const buyTotal = roundQty(lftBuys.reduce((s, e) => s + Number(e.quantity), 0));
  const sellTotal = roundQty(lftSells.reduce((s, e) => s + Math.abs(Number(e.quantity)), 0));
  const rawSumQty = roundQty(lftEvents.reduce((s, e) => s + Number(e.quantity ?? 0), 0));
  const custodyFinal = roundQty(lftQtyEod(allEvents, to));

  const snap = loadSnapshotFromDados();
  const hbQty =
    snap?.components && typeof snap.components === 'object'
      ? Number((snap.components as Record<string, unknown>).renda_fixa_quantidade ?? (snap.components as Record<string, unknown>).quantidade ?? 0)
      : null;

  const tdTable = await loadTdTableFromExtracts();
  const tdBuy = roundQty(tdTable.filter((r) => r.op === 'buy').reduce((s, r) => s + r.qty, 0));
  const tdSell = roundQty(tdTable.filter((r) => r.op === 'sell').reduce((s, r) => s + r.qty, 0));

  const dayIssues: Array<Record<string, unknown>> = [];
  const lftTrail: Array<Record<string, unknown>> = [];
  let prevLftQty: number | null = null;

  for (const row of matrix.rows) {
    const day = row.date;
    if (!isWeekday(day)) continue;

    const evStatus = cellText(row, 'events_status');
    const evCount = Number(row.cells.events_count?.value ?? 0);
    const orphans = cellText(row, 'events_orphans');
    const notes = cellText(row, 'events_notes');
    const extract = cellText(row, 'events_extract');
    const business = cellText(row, 'events_business');

    const lftKey = `${LFT_TICKER}__qty`;
    const lftCellQty = row.cells[lftKey]?.value;
    const lftQty = lftCellQty != null ? roundQty(Number(lftCellQty)) : lftQtyEod(allEvents, day);
    const mov = lftDayMovement(allEvents, day);
    const expectedDelta = roundQty(mov.buyQty - mov.sellQty);
    const actualDelta = prevLftQty != null ? roundQty(lftQty - prevLftQty) : null;
    const lftMismatch =
      actualDelta != null && Math.abs(actualDelta - expectedDelta) > 0.0001 && (mov.count > 0 || Math.abs(actualDelta) > 0.0001);

    if (mov.count > 0 || (prevLftQty != null && lftQty !== prevLftQty)) {
      lftTrail.push({
        date: day,
        qty_eod: lftQty,
        delta: actualDelta,
        buy: mov.buyQty,
        sell: mov.sellQty,
        expected_delta: expectedDelta,
        mismatch: lftMismatch,
        movements: mov.lines,
      });
    }

    const issues: string[] = [];
    if (evStatus === 'Erro') issues.push('event_status_error');
    if (evStatus === 'Atenção') issues.push('event_status_warn');
    if (orphans) issues.push('orphan_events');
    if (lftMismatch) issues.push('lft_qty_mismatch');
    if (mov.count > 0 && !extract && !notes && !business) issues.push('lft_no_event_summary');

    const dayEv = allEvents.filter((e) => String(e.transaction_date || '').slice(0, 10) === day);
    const daySummary = summarizeGeneralAuditDayEvents(dayEv);

    if (issues.length > 0 || evCount > 0) {
      dayIssues.push({
        date: day,
        issues,
        event_count: evCount,
        status: daySummary.status,
        status_label: daySummary.statusLabel,
        patrimony: row.cells.patrimony?.value,
        cash: row.cells.cash_settled?.value,
        lft_qty: lftQty,
        lft_movement: mov,
        notes_summary: notes || daySummary.notesSummary,
        extract_summary: extract || daySummary.extractSummary,
        business_summary: business || daySummary.businessSummary,
        orphan_summary: orphans || daySummary.orphanSummary,
      });
    }

    prevLftQty = lftQty;
  }

  const tdNotInLedger = tdTable.filter((td) => {
    if (td.op !== 'sell' && td.op !== 'buy') return false;
    const match = lftEvents.some((e) => {
      const d = String(e.transaction_date || '').slice(0, 10);
      if (d !== td.date) return false;
      const qty = Math.abs(Number(e.quantity));
      return Math.abs(qty - td.qty) < 0.01;
    });
    return !match;
  });

  const ledgerNotInTd = lftEvents
    .filter((e) => String(e.transaction_type) !== 'opening_balance')
    .filter((e) => {
      const d = String(e.transaction_date || '').slice(0, 10);
      const qty = Math.abs(Number(e.quantity));
      return !tdTable.some((td) => td.date === d && Math.abs(td.qty - qty) < 0.01);
    })
    .map((e) => ({
      date: String(e.transaction_date).slice(0, 10),
      qty: Number(e.quantity),
      type: e.transaction_type,
      ref: e.broker_note_ref,
      net: Number(e.total_net_value ?? 0),
    }));

  const errorDays = dayIssues.filter((d) => (d.issues as string[]).includes('event_status_error'));
  const warnDays = dayIssues.filter((d) => (d.issues as string[]).includes('event_status_warn'));
  const lftMismatchDays = lftTrail.filter((d) => d.mismatch);

  const report = {
    generated_at: new Date().toISOString(),
    organization_id: ORG,
    from,
    to,
    business_days: matrix.businessDays,
    data_source: matrix.dataSource,
    tickers: matrix.tickers,
    lft_summary: {
      opening_qty: roundQty(openingLft),
      ledger_buys: buyTotal,
      ledger_sells: sellTotal,
      ledger_net: roundQty(openingLft + buyTotal - sellTotal),
      raw_sum_qty: rawSumQty,
      custody_engine_qty: custodyFinal,
      custody_vs_raw_delta: roundQty(custodyFinal - rawSumQty),
      hb_snapshot_qty: hbQty,
      delta_vs_hb: hbQty != null ? roundQty(custodyFinal - hbQty) : null,
      td_table_buys: tdBuy,
      td_table_sells: tdSell,
      td_table_net_from_58: roundQty(58 + tdBuy - tdSell),
      td_sells_missing_in_ledger: roundQty(tdSell - sellTotal),
      td_not_in_ledger: tdNotInLedger,
      ledger_not_in_td: ledgerNotInTd,
    },
    matrix_rows: matrix.rows.length,
    days_with_activity: dayIssues.length,
    error_days: errorDays.length,
    warn_days: warnDays.length,
    lft_mismatch_days: lftMismatchDays.length,
    top_error_days: errorDays.slice(0, 15),
    top_warn_days: warnDays.slice(0, 15),
    lft_trail: lftTrail,
    lft_mismatch_days_detail: lftMismatchDays,
    all_day_issues: dayIssues.filter((d) => (d.issues as string[]).length > 0),
    matrix: {
      columns: matrix.columns,
      rows: matrix.rows,
    },
  };

  const stamp = today;
  const docsDir = path.join(process.cwd(), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const jsonPath = path.join(docsDir, `validacao-auditoria-geral-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const mdLines: string[] = [
    `# Validação Auditoria Geral — ${stamp}`,
    '',
    `Período: **${from}** → **${to}** · ${matrix.businessDays} dias úteis · fonte matriz: \`${matrix.dataSource}\``,
    '',
    '## LFT — resumo',
    '',
    '| Métrica | Valor |',
    '| --- | ---: |',
    `| Abertura livro | ${openingLft} |`,
    `| Compras livro | ${buyTotal} |`,
    `| Vendas livro | ${sellTotal} |`,
    `| Saldo livro (abertura + compras − vendas) | ${roundQty(openingLft + buyTotal - sellTotal)} |`,
    `| Custódia EOD ${to} | ${custodyFinal} |`,
    hbQty != null ? `| Snapshot HB renda fixa | ${hbQty} |` : '',
    hbQty != null ? `| Δ custódia vs HB | ${roundQty(custodyFinal - hbQty)} |` : '',
    `| TD extrato compras | ${tdBuy} |`,
    `| TD extrato vendas | ${tdSell} |`,
    `| TD saldo teórico (58 + compras − vendas) | ${roundQty(58 + tdBuy - tdSell)} |`,
    `| Vendas TD sem par no livro | ${roundQty(tdSell - sellTotal)} |`,
    '',
    '## Dias com erro de eventos',
    '',
  ];

  if (errorDays.length === 0) mdLines.push('_Nenhum dia com status Erro._');
  else {
    for (const d of errorDays.slice(0, 20)) {
      mdLines.push(`### ${d.date}`);
      mdLines.push(`- Órfãos: ${d.orphan_summary || '—'}`);
      mdLines.push(`- Negócios: ${d.business_summary || '—'}`);
      mdLines.push('');
    }
  }

  mdLines.push('## Movimentos LFT no livro (por dia)');
  mdLines.push('');
  for (const t of lftTrail) {
    mdLines.push(`- **${t.date}** qty=${t.qty_eod} Δ=${t.delta} (compra ${t.buy}, venda ${t.sell})${t.mismatch ? ' ⚠ mismatch' : ''}`);
    for (const line of t.movements as string[]) mdLines.push(`  - ${line}`);
  }

  if (ledgerNotInTd.length) {
    mdLines.push('', '## Lançamentos LFT no livro sem par no extrato TD');
    for (const r of ledgerNotInTd) {
      mdLines.push(`- ${r.date} qty=${r.qty} ${r.type} ref=${r.ref} net=${r.net}`);
    }
  }

  if (tdNotInLedger.length) {
    mdLines.push('', '## Operações TD no extrato sem par no livro');
    for (const r of tdNotInLedger) {
      mdLines.push(`- ${r.date} ${r.op} qty=${r.qty} gross=${r.gross} (${r.month})`);
    }
  }

  const mdPath = path.join(docsDir, `validacao-auditoria-geral-${stamp}.md`);
  fs.writeFileSync(mdPath, mdLines.filter(Boolean).join('\n'), 'utf8');

  console.log('\n=== Auditoria Geral — validação ===');
  console.log(`Matriz: ${matrix.rows.length} linhas | ${matrix.tickers.length} ativos`);
  console.log(`Dias com atividade/alerta: ${dayIssues.length} | Erro: ${errorDays.length} | Atenção: ${warnDays.length}`);
  console.log('\n--- LFT ---');
  console.log(`Abertura: ${openingLft} | Compras: ${buyTotal} | Vendas: ${sellTotal}`);
  console.log(`Saldo livro: ${roundQty(openingLft + buyTotal - sellTotal)} | Custódia EOD: ${custodyFinal}`);
  if (hbQty != null) console.log(`HB snapshot: ${hbQty} | Δ: ${roundQty(custodyFinal - hbQty)}`);
  console.log(`TD 58+compras-vendas: ${roundQty(58 + tdBuy - tdSell)} | Vendas TD faltando livro: ${roundQty(tdSell - sellTotal)}`);
  console.log(`Dias LFT mismatch: ${lftMismatchDays.length}`);
  console.log(`\nJSON: ${jsonPath}`);
  console.log(`MD:   ${mdPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
