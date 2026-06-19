/**
 * Batimento completo: TODAS as notas PDF (Dados do Homebroker) × livro razão real.
 *
 *   $env:BTG_DADOS_DIR="...\Dados do Homebroker"
 *   npx ts-node scripts/audit-all-notes-pdf-vs-ledger.ts
 *   npx ts-node scripts/audit-all-notes-pdf-vs-ledger.ts --json
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  parseBtgBrokerageNoteBlocks,
  dedupeBrokerageNotes,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';
import { brokerageNotesToLedgerLines } from '../src/core/invest/btgBrokerageNoteLedgerTranslator';
import {
  buildLedgerDedupIndex,
  buildOperationFingerprint,
} from '../src/core/invest/ledgerOperationDedup';
import { pdfBufferToLines } from '../src/core/invest/btgPdfTextExtract';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';
import {
  cashBalanceFromLedger,
  settledCashBalanceFromLedger,
  isCashInvestTicker,
} from '../src/core/invest/cashInvestLedger';
import { createInvestPool } from './lib/invest-db-pool';
import { loadSnapshotFromDados } from './lib/patrimony-dados-json';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const JSON_OUT = process.argv.includes('--json');
const TODAY = new Date().toISOString().slice(0, 10);

const DADOS_DIR =
  process.env.BTG_DADOS_DIR ||
  path.join(
    'G:',
    'Meu Drive',
    '01 - Nova Estrutura',
    'Trabalhos',
    'FOCCUS',
    'Softwares',
    'co_ceo_platform',
    'Dados do Homebroker'
  );

const NOTES_ROOT = path.join(DADOS_DIR, 'Notas de Corretagem');
const OUT = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');

function inferCategory(name: string): BtgNoteCategory {
  const u = name.toUpperCase();
  if (u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

function listNotePdfs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listNotePdfs(full));
    else if (/\.pdf$/i.test(ent.name) && !/summary\.pdf$/i.test(ent.name)) out.push(full);
  }
  return out.sort();
}

function assetBucket(assetType: string | undefined, ticker: string): string {
  const t = ticker.toUpperCase();
  if (assetType === 'fixed_income' || t.startsWith('LFT')) return 'LFT/TD';
  if (assetType === 'option_call' || assetType === 'option_put') return 'opcoes';
  if (assetType === 'stock' || assetType === 'fii') return 'acoes';
  if (assetType === 'cash') return 'caixa';
  return assetType || 'outros';
}

function qtyMatch(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < 0.01;
}

function priceMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.02 || (a > 1000 && Math.abs((a - b) / a) < 0.0001);
}

function isPatrimonyTrade(e: LedgerEvent): boolean {
  if (e.asset_type === 'cash') return false;
  const op = String(e.transaction_type);
  return !['fee', 'dividend', 'jcp'].includes(op);
}

function lineFingerprint(line: LedgerImportLine): string {
  return buildOperationFingerprint({
    date: line.date,
    ticker: line.ticker,
    operation: line.operation,
    quantity: line.quantity,
    unit_price: line.unit_price,
    asset_type: line.asset_type,
  });
}

function countByBucket(items: Array<{ asset_type?: string; ticker?: string }>): Record<string, number> {
  const m: Record<string, number> = {};
  for (const it of items) {
    const b = assetBucket(it.asset_type, String(it.ticker || ''));
    m[b] = (m[b] || 0) + 1;
  }
  return m;
}

async function parseAllNotesFromPdfs(): Promise<{
  pdfCount: number;
  parseErrors: Array<{ file: string; error: string }>;
  notesKept: number;
  noteLines: LedgerImportLine[];
}> {
  const pdfs = listNotePdfs(NOTES_ROOT);
  const parseErrors: Array<{ file: string; error: string }> = [];
  const allNotes = [];

  for (const pdfPath of pdfs) {
    try {
      const buf = fs.readFileSync(pdfPath);
      const lines = await pdfBufferToLines(buf);
      const rel = path.relative(NOTES_ROOT, pdfPath).replace(/\\/g, '/');
      allNotes.push(...parseBtgBrokerageNoteBlocks(lines, rel, inferCategory(path.basename(pdfPath))));
    } catch (e) {
      parseErrors.push({
        file: path.relative(NOTES_ROOT, pdfPath),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const { kept } = dedupeBrokerageNotes(allNotes);
  const noteLines = brokerageNotesToLedgerLines(kept);
  return { pdfCount: pdfs.length, parseErrors, notesKept: kept.length, noteLines };
}

function computeLftQty(events: LedgerEvent[]): {
  qty: number;
  buys: number;
  sells: number;
  opening: number;
  costAdjustments: number;
  timeline: Array<{ date: string; op: string; qty: number; ref: string }>;
} {
  const lft = events.filter((e) => String(e.asset_ticker || '').includes('LFT'));
  let qty = 0;
  let buys = 0;
  let sells = 0;
  let opening = 0;
  let costAdjustments = 0;
  const timeline: Array<{ date: string; op: string; qty: number; ref: string }> = [];

  for (const e of lft.sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)))) {
    const op = String(e.transaction_type);
    const q = Number(e.quantity);
    if (op === 'opening_balance') {
      opening += q;
      qty += q;
    } else if (op === 'buy') {
      buys += q;
      qty += q;
    } else if (op === 'sell') {
      sells += Math.abs(q);
      qty += q;
    } else if (op === 'cost_adjustment') {
      costAdjustments += 1;
    }
    if (['opening_balance', 'buy', 'sell'].includes(op)) {
      timeline.push({
        date: String(e.transaction_date).slice(0, 10),
        op,
        qty: q,
        ref: String(e.broker_note_ref || '').slice(0, 50),
      });
    }
  }
  return { qty, buys, sells, opening, costAdjustments, timeline };
}

async function main() {
  if (!fs.existsSync(NOTES_ROOT)) {
    console.error(`Pasta de notas não encontrada: ${NOTES_ROOT}`);
    process.exit(1);
  }

  console.log('=== Batimento TODAS as notas PDF × livro razão ===\n');
  console.log(`Fonte PDF: ${NOTES_ROOT}`);
  console.log(`Org: ${ORG}\n`);

  const { pdfCount, parseErrors, notesKept, noteLines } = await parseAllNotesFromPdfs();
  console.log(`PDFs (sem SUMMARY): ${pdfCount}`);
  console.log(`Notas deduplicadas: ${notesKept}`);
  console.log(`Linhas esperadas (notas→ledger): ${noteLines.length}`);
  if (parseErrors.length) {
    console.log(`Erros de parse: ${parseErrors.length}`);
    for (const pe of parseErrors.slice(0, 5)) console.log(`  · ${pe.file}: ${pe.error}`);
  }

  const pool = createInvestPool();
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', TODAY);
  const index = buildLedgerDedupIndex(events);
  const trades = events.filter(isPatrimonyTrade);

  const expectedRefs = new Set(
    noteLines.map((l) => String(l.broker_note_ref || '')).filter(Boolean)
  );
  const ledgerNoteRefs = new Set(
    events
      .map((e) => String(e.broker_note_ref || ''))
      .filter((r) => r.startsWith('BTG-NOTA-'))
  );

  const missing: Array<Record<string, unknown>> = [];
  const mismatch: Array<Record<string, unknown>> = [];
  const matchedByRef = new Set<string>();

  const eventByRef = new Map<string, LedgerEvent>();
  for (const e of events) {
    const ref = String(e.broker_note_ref || '');
    if (ref) eventByRef.set(ref, e);
  }

  for (const line of noteLines) {
    const ref = String(line.broker_note_ref || '');
    if (!ref) continue;

    const direct = eventByRef.get(ref);
    const indexed = index.byRef.get(ref);
    const patId = direct?.id || indexed?.patrimonyEventId;

    if (patId) {
      matchedByRef.add(ref);
      const ev = trades.find((t) => t.id === patId);
      if (ev && (!qtyMatch(line.quantity, ev.quantity) || !priceMatch(line.unit_price, ev.unit_price))) {
        mismatch.push({
          ref,
          ticker: line.ticker,
          operation: line.operation,
          expectedQty: line.quantity,
          ledgerQty: ev.quantity,
          expectedPrice: line.unit_price,
          ledgerPrice: ev.unit_price,
          bucket: assetBucket(line.asset_type, line.ticker),
        });
      }
      continue;
    }

    const fp = lineFingerprint(line);
    const fpHits = index.byFingerprint.get(fp) || [];
    if (fpHits.length > 0) continue;

    missing.push({
      ref,
      date: line.date,
      ticker: line.ticker,
      operation: line.operation,
      quantity: line.quantity,
      unit_price: line.unit_price,
      asset_type: line.asset_type,
      bucket: assetBucket(line.asset_type, line.ticker),
      notes: String(line.notes || '').slice(0, 80),
    });
  }

  const extraInLedger: Array<Record<string, unknown>> = [];
  for (const e of trades) {
    const ref = String(e.broker_note_ref || '');
    if (!ref.startsWith('BTG-NOTA-')) continue;
    if (expectedRefs.has(ref)) continue;
    extraInLedger.push({
      ref,
      date: e.transaction_date,
      ticker: e.asset_ticker,
      asset_type: e.asset_type,
      operation: e.transaction_type,
      qty: e.quantity,
      price: e.unit_price,
      bucket: assetBucket(e.asset_type, String(e.asset_ticker || '')),
    });
  }

  const lft = computeLftQty(events);
  const snapshot = loadSnapshotFromDados();
  const hbComponents = snapshot?.components as
    | {
        renda_fixa?: { quantidade?: number };
        conta_investimento?: { valor?: number; saldo_disponivel?: number };
      }
    | undefined;
  const hbLftQty = hbComponents?.renda_fixa?.quantidade ?? null;
  const hbCash =
    hbComponents?.conta_investimento?.valor ??
    hbComponents?.conta_investimento?.saldo_disponivel ??
    null;

  const cashGross = cashBalanceFromLedger(events, TODAY);
  const cashSettled = settledCashBalanceFromLedger(events, TODAY);

  const [[assetRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT quantity FROM patrimony_items
     WHERE organization_id=? AND identifier LIKE 'LFT%' AND deleted_at IS NULL LIMIT 1`,
    [ORG]
  );

  const noteMatchPct =
    noteLines.length > 0
      ? Math.round(((noteLines.length - missing.length) / noteLines.length) * 10000) / 100
      : 100;

  const report = {
    generatedAt: new Date().toISOString(),
    organizationId: ORG,
    source: { notesRoot: NOTES_ROOT, pdfCount, notesKept, parseErrors },
    summary: {
      expectedNoteLines: noteLines.length,
      expectedUniqueRefs: expectedRefs.size,
      ledgerNoteRefs: ledgerNoteRefs.size,
      matchedByRef: matchedByRef.size,
      missingInLedger: missing.length,
      mismatchQtyPrice: mismatch.length,
      extraInLedger: extraInLedger.length,
      noteMatchPct,
      ledgerEventsTotal: events.length,
      ledgerPatrimonyTrades: trades.length,
    },
    missingByBucket: countByBucket(missing.map((m) => ({ asset_type: String(m.asset_type), ticker: String(m.ticker) }))),
    mismatchByBucket: countByBucket(mismatch.map((m) => ({ ticker: String(m.ticker) }))),
    extraByBucket: countByBucket(extraInLedger.map((e) => ({ asset_type: String(e.asset_type), ticker: String(e.ticker) }))),
    lft: {
      ledgerQtyComputed: lft.qty,
      patrimonyItemQty: assetRow ? Number(assetRow.quantity) : null,
      homebrokerRefQty: hbLftQty,
      opening: lft.opening,
      buys: lft.buys,
      sells: lft.sells,
      costAdjustmentEntries: lft.costAdjustments,
      qtyOkVsHomebroker: hbLftQty != null ? Math.abs(lft.qty - hbLftQty) < 0.01 : null,
      timeline: lft.timeline,
    },
    cash: {
      ledgerGross: cashGross,
      ledgerSettled: cashSettled,
      homebrokerRef: hbCash,
      deltaVsHomebroker: hbCash != null ? cashSettled - hbCash : null,
    },
    missingSample: missing.slice(0, 50),
    mismatchSample: mismatch.slice(0, 30),
    extraSample: extraInLedger.slice(0, 30),
    structuralIssues: [] as string[],
  };

  if (missing.length > 0) {
    report.structuralIssues.push(
      `${missing.length} pernas de notas PDF não estão no livro — importação incompleta ou dedup errado.`
    );
  }
  if (mismatch.length > 0) {
    report.structuralIssues.push(
      `${mismatch.length} pernas com qty/preço divergente entre nota e livro.`
    );
  }
  if (hbLftQty != null && Math.abs(lft.qty - hbLftQty) > 0.01) {
    report.structuralIssues.push(
      `LFT: livro tem ${lft.qty} cotas vs homebroker ${hbLftQty} (Δ ${lft.qty - hbLftQty}).`
    );
  }
  if (assetRow && hbLftQty != null && Math.abs(Number(assetRow.quantity) - hbLftQty) > 0.01) {
    report.structuralIssues.push(
      `LFT patrimony_items: ${Number(assetRow.quantity)} vs homebroker ${hbLftQty}.`
    );
  }
  if (lft.sells > 0 && lft.qty === lft.opening) {
    report.structuralIssues.push(
      'LFT: há vendas registradas no caixa/extrato mas qty patrimonial não baixou (takeTesouroDiretoMovement falhou?).'
    );
  }
  if (hbCash != null && Math.abs(cashSettled - hbCash) > 100) {
    report.structuralIssues.push(
      `Caixa liquidado ${cashSettled.toFixed(2)} vs homebroker ${hbCash} (Δ ${(cashSettled - hbCash).toFixed(2)}).`
    );
  }
  const extractDupes = events.filter(
    (e) =>
      String(e.broker_note_ref || '').startsWith('BTG-EXT-') &&
      String(e.transaction_type) !== 'fee'
  ).length;
  if (extractDupes > 50) {
    report.structuralIssues.push(
      `${extractDupes} movimentos patrimoniais via extrato BTG-EXT — risco de duplicação com notas.`
    );
  }

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = TODAY;
  const outPath = path.join(OUT, `audit-all-notes-pdf-vs-ledger-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n--- RESUMO ---');
    console.log(`Cobertura notas→livro: ${noteMatchPct}%`);
    console.log(`Faltando no livro:     ${missing.length}`);
    console.log(`Qty/preço divergente:  ${mismatch.length}`);
    console.log(`Extras no livro:       ${extraInLedger.length}`);
    console.log('\nFaltando por bucket:', report.missingByBucket);
    console.log('\n--- LFT ---');
    console.log(`  Abertura: ${lft.opening} | Compras: ${lft.buys} | Vendas: ${lft.sells} | Qty calc: ${lft.qty}`);
    console.log(`  patrimony_items: ${assetRow?.quantity ?? '—'} | HB ref: ${hbLftQty ?? '—'}`);
    console.log('\n--- CAIXA ---');
    console.log(`  Liquidado: R$ ${cashSettled.toFixed(2)} | HB ref: ${hbCash ?? '—'}`);
    if (report.structuralIssues.length) {
      console.log('\n--- PROBLEMAS ESTRUTURAIS ---');
      for (const s of report.structuralIssues) console.log(`  · ${s}`);
    }
    if (missing.length) {
      console.log('\nAmostra faltando (20):');
      for (const m of missing.slice(0, 20)) {
        console.log(`  ${m.date} ${m.ticker} ${m.operation} qty=${m.quantity} ref=${m.ref}`);
      }
    }
    console.log(`\nRelatório completo: ${outPath}`);
  }

  await pool.end();
  process.exit(missing.length > 0 || mismatch.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

