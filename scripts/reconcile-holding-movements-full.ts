/**
 * Batimento 100%: cada perna patrimonial esperada (notas TXT + abertura 01/01)
 * vs livro, por tipo de ativo (ação, opção, LFT, locação).
 *
 *   npx ts-node scripts/reconcile-holding-movements-full.ts
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
  fingerprintFromLedgerEvent,
} from '../src/core/invest/ledgerOperationDedup';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const TXT_DIR = path.join(process.cwd(), 'dados importação', 'documentos_txt_extraidos');
const OUT = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');
const OPENING_BATCH = 'OPENING-BTG-2026-01-01';

const OPENING_EXPECTED: Array<{
  ref: string;
  ticker: string;
  asset_type: string;
  operation: string;
  quantity: number;
  unit_price: number;
}> = [
  { ref: `${OPENING_BATCH}:PRIO3`, ticker: 'PRIO3', asset_type: 'stock', operation: 'opening_balance', quantity: 5400, unit_price: 38.33 },
  { ref: `${OPENING_BATCH}:LFT-20310301`, ticker: 'LFT-20310301', asset_type: 'fixed_income', operation: 'opening_balance', quantity: 1, unit_price: 1_000_341.65 },
  { ref: `${OPENING_BATCH}:PRIOQ43`, ticker: 'PRIOQ43', asset_type: 'option_put', operation: 'opening_balance', quantity: -31200, unit_price: 1.426748 },
  { ref: `${OPENING_BATCH}:PRIOR407`, ticker: 'PRIOR407', asset_type: 'option_put', operation: 'opening_balance', quantity: -6300, unit_price: 0.912254 },
  { ref: `${OPENING_BATCH}:PRIOA407`, ticker: 'PRIOA407', asset_type: 'option_call', operation: 'opening_balance', quantity: -5400, unit_price: 0.626905 },
];

function* walk(d: string): Generator<string> {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('_ALL.txt')) yield full;
  }
}

function inferCategory(name: string): BtgNoteCategory {
  const u = name.toUpperCase();
  if (u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

function assetBucket(assetType: string, ticker: string): string {
  const t = ticker.toUpperCase();
  if (assetType === 'fixed_income' || t.startsWith('LFT')) return 'LFT/TD';
  if (assetType === 'option_call' || assetType === 'option_put') return 'opções';
  if (assetType === 'stock' || assetType === 'fii') return 'ações/FII';
  if (assetType === 'cash') return 'caixa';
  return assetType || 'outros';
}

function isPatrimonyTrade(e: LedgerEvent): boolean {
  if (e.asset_type === 'cash') return false;
  const op = String(e.transaction_type);
  return !['fee', 'dividend', 'jcp'].includes(op);
}

function isPatrimonyMovement(e: LedgerEvent): boolean {
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

function qtyMatch(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < 0.01;
}

function priceMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.02 || (a > 1000 && Math.abs((a - b) / a) < 0.0001);
}

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const index = buildLedgerDedupIndex(events);
  const trades = events.filter(isPatrimonyTrade);
  const allPatrimony = events.filter(isPatrimonyMovement);

  const allNotes = [];
  for (const f of walk(TXT_DIR)) {
    const lines = fs.readFileSync(f, 'utf-8').split(/\r?\n/);
    allNotes.push(...parseBtgBrokerageNoteBlocks(lines, f, inferCategory(path.basename(f))));
  }
  const { kept } = dedupeBrokerageNotes(allNotes);
  const noteLines = brokerageNotesToLedgerLines(kept);

  type Expected = {
    source: 'nota' | 'abertura' | 'extrato';
    ref: string;
    line: LedgerImportLine | (typeof OPENING_EXPECTED)[0];
  };
  const expected: Expected[] = [
    ...noteLines.map((line) => ({
      source: 'nota' as const,
      ref: String(line.broker_note_ref || ''),
      line,
    })),
    ...OPENING_EXPECTED.map((o) => ({
      source: 'abertura' as const,
      ref: o.ref,
      line: o,
    })),
  ];

  const matchedByRef = new Set<string>();
  const matchedByFp = new Set<string>();
  const missing: Array<Record<string, unknown>> = [];
  const mismatch: Array<Record<string, unknown>> = [];

  const eventByRef = new Map<string, LedgerEvent>();
  for (const e of events) {
    const ref = String(e.broker_note_ref || '');
    if (ref) eventByRef.set(ref, e);
  }

  for (const exp of expected) {
    if (!exp.ref) continue;
    const direct = eventByRef.get(exp.ref);
    const indexed = index.byRef.get(exp.ref);
    const patId = direct?.id || indexed?.patrimonyEventId;
    if (patId) {
      matchedByRef.add(exp.ref);
      const ev = trades.find((t) => t.id === patId);
      if (ev && exp.source !== 'abertura') {
        const line = exp.line as LedgerImportLine;
        if (!qtyMatch(line.quantity, ev.quantity) || !priceMatch(line.unit_price, ev.unit_price)) {
          mismatch.push({
            ref: exp.ref,
            source: exp.source,
            ticker: line.ticker,
            expectedQty: line.quantity,
            ledgerQty: ev.quantity,
            expectedPrice: line.unit_price,
            ledgerPrice: ev.unit_price,
          });
        }
      }
      continue;
    }

    const line = exp.line as LedgerImportLine;
    const fp =
      exp.source === 'abertura'
        ? buildOperationFingerprint({
            date: '2026-01-01',
            ticker: (exp.line as (typeof OPENING_EXPECTED)[0]).ticker,
            operation: 'opening_balance',
            quantity: (exp.line as (typeof OPENING_EXPECTED)[0]).quantity,
            unit_price: (exp.line as (typeof OPENING_EXPECTED)[0]).unit_price,
            asset_type: (exp.line as (typeof OPENING_EXPECTED)[0]).asset_type,
          })
        : lineFingerprint(line);

    const fpHits = index.byFingerprint.get(fp) || [];
    if (fpHits.length > 0) {
      matchedByFp.add(exp.ref);
      continue;
    }

    missing.push({
      ref: exp.ref,
      source: exp.source,
      ticker: exp.source === 'abertura' ? (exp.line as (typeof OPENING_EXPECTED)[0]).ticker : line.ticker,
      asset_type:
        exp.source === 'abertura'
          ? (exp.line as (typeof OPENING_EXPECTED)[0]).asset_type
          : line.asset_type,
      operation:
        exp.source === 'abertura'
          ? (exp.line as (typeof OPENING_EXPECTED)[0]).operation
          : line.operation,
    });
  }

  const expectedRefs = new Set(expected.map((e) => e.ref).filter(Boolean));
  const extraInLedger: Array<Record<string, unknown>> = [];
  for (const e of allPatrimony) {
    const ref = String(e.broker_note_ref || '');
    if (!ref) continue;
    if (ref.startsWith('BTG-EXTRATO') || ref.startsWith('BTG-EXT-') || ref.includes('CLEAR')) continue;
    if (expectedRefs.has(ref)) continue;
    if (String(e.transaction_type) === 'opening_balance' && ref.startsWith(OPENING_BATCH)) continue;
    extraInLedger.push({
      ref,
      date: e.transaction_date,
      ticker: e.asset_ticker,
      asset_type: e.asset_type,
      operation: e.transaction_type,
      qty: e.quantity,
      price: e.unit_price,
    });
  }

  const byBucket = (items: Array<{ asset_type?: string; ticker?: string }>) => {
    const m: Record<string, number> = {};
    for (const it of items) {
      const b = assetBucket(String(it.asset_type || ''), String(it.ticker || ''));
      m[b] = (m[b] || 0) + 1;
    }
    return m;
  };

  const extractPatrimony = allPatrimony.filter((e) => {
    const ref = String(e.broker_note_ref || '');
    return ref.startsWith('BTG-EXTRATO') || ref.startsWith('BTG-EXT-');
  });

  const noteExpected = expected.filter((e) => e.source === 'nota');
  const noteMatched =
    noteExpected.length -
    missing.filter((m) => m.source === 'nota').length;

  const report = {
    generatedAt: new Date().toISOString(),
    organizationId: ORG,
    summary: {
      expectedTotal: expected.length,
      expectedNotas: noteLines.length,
      expectedAbertura: OPENING_EXPECTED.length,
      matchedByRef: matchedByRef.size,
      matchedByFingerprintOnly: matchedByFp.size,
      missingCount: missing.length,
      mismatchQtyPrice: mismatch.length,
      extraInLedgerCount: extraInLedger.length,
      ledgerPatrimonyTrades: trades.length,
      ledgerExtractPatrimony: extractPatrimony.length,
      noteMatchPct:
        noteExpected.length > 0
          ? Math.round((noteMatched / noteExpected.length) * 10000) / 100
          : 100,
    },
    missingByBucket: byBucket(
      missing.map((m) => ({ asset_type: String(m.asset_type), ticker: String(m.ticker) }))
    ),
    missing,
    mismatch,
    extraSample: extraInLedger.slice(0, 40),
    extractPatrimonySample: extractPatrimony.slice(0, 15).map((e) => ({
      ref: e.broker_note_ref,
      date: e.transaction_date,
      ticker: e.asset_ticker,
      op: e.transaction_type,
      qty: e.quantity,
    })),
  };

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(OUT, `reconcile-movements-full-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== Batimento 100% movimentos patrimoniais ===\n');
  console.log(`Esperado (notas):     ${noteLines.length}`);
  console.log(`Esperado (abertura):  ${OPENING_EXPECTED.length}`);
  console.log(`Match por ref:        ${matchedByRef.size}`);
  console.log(`Match só fingerprint: ${matchedByFp.size}`);
  console.log(`Faltando no livro:    ${missing.length}`);
  console.log(`Qty/preço divergente: ${mismatch.length}`);
  console.log(`Extras no livro:      ${extraInLedger.length}`);
  console.log(`Pernas via extrato:   ${extractPatrimony.length}`);
  console.log(`Cobertura notas:      ${report.summary.noteMatchPct}%`);
  if (missing.length) {
    console.log('\nFaltando:');
    for (const m of missing.slice(0, 15)) {
      console.log(`  ${m.ref} | ${m.ticker} | ${m.source}`);
    }
  }
  if (mismatch.length) {
    console.log('\nDivergência qty/preço:');
    for (const m of mismatch.slice(0, 10)) {
      console.log(`  ${m.ref} qty ${m.expectedQty}→${m.ledgerQty} px ${m.expectedPrice}→${m.ledgerPrice}`);
    }
  }
  console.log(`\nRelatório: ${outPath}`);

  await pool.end();
  process.exit(missing.length > 0 || mismatch.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
