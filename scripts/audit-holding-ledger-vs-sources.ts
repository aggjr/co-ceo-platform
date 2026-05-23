/**
 * Cruza livro (patrimônio + caixa) com fontes BTG: notas TXT e extrato normalizado.
 * Gera JSON em local-import/btg-sources/auditoria/.
 *
 *   npx ts-node scripts/audit-holding-ledger-vs-sources.ts
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
import { buildLedgerDedupIndex } from '../src/core/invest/ledgerOperationDedup';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

/** Pernas removidas de propósito (duplicata caixa na mesma nota). */
const KNOWN_REMOVED_NOTE_REFS = new Set([
  'BTG-NOTA-31582497#2026-04-27#9',
  'BTG-NOTA-31609259#2026-04-28#5',
]);
const TXT_DIR = path.join(process.cwd(), 'dados importação', 'documentos_txt_extraidos');
const OUT = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');

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

  const allNotes = [];
  for (const f of walk(TXT_DIR)) {
    const lines = fs.readFileSync(f, 'utf-8').split(/\r?\n/);
    allNotes.push(...parseBtgBrokerageNoteBlocks(lines, f, inferCategory(path.basename(f))));
  }
  const { kept } = dedupeBrokerageNotes(allNotes);
  const expectedLines = brokerageNotesToLedgerLines(kept);
  const expectedRefs = new Set(
    expectedLines
      .map((l) => String(l.broker_note_ref || ''))
      .filter(Boolean)
  );

  const ledgerRefs = new Set(
    events
      .map((e) => String(e.broker_note_ref || ''))
      .filter((r) => r.startsWith('BTG-NOTA-'))
  );

  const missingInLedger: string[] = [];
  for (const ref of expectedRefs) {
    if (KNOWN_REMOVED_NOTE_REFS.has(ref)) continue;
    if (!index.byRef.has(ref) && !ledgerRefs.has(ref)) {
      missingInLedger.push(ref);
    }
  }

  const extraInLedger: string[] = [];
  for (const ref of ledgerRefs) {
    if (!expectedRefs.has(ref) && ref.includes('BTG-NOTA-')) {
      extraInLedger.push(ref);
    }
  }

  const [cashRow] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) saldo
     FROM financial_ledger_entries
     WHERE organization_id = ? AND deleted_at IS NULL`,
    [ORG]
  );

  const [pleCount] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) c FROM patrimony_ledger_entries
     WHERE organization_id = ? AND deleted_at IS NULL`,
    [ORG]
  );

  const [fleCount] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) c FROM financial_ledger_entries
     WHERE organization_id = ? AND deleted_at IS NULL`,
    [ORG]
  );

  const report = {
    generatedAt: new Date().toISOString(),
    organizationId: ORG,
    notesParsed: kept.length,
    expectedBrokerRefs: expectedRefs.size,
    ledgerBrokerRefs: ledgerRefs.size,
    missingInLedgerCount: missingInLedger.length,
    extraInLedgerCount: extraInLedger.length,
    missingSample: missingInLedger.slice(0, 30),
    extraSample: extraInLedger.slice(0, 30),
    ledgerEvents: events.length,
    patrimonyEntries: pleCount[0]!.c,
    financialEntries: fleCount[0]!.c,
    cashBalanceFromFinancialLedger: Number(cashRow[0]?.saldo ?? 0),
  };

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(OUT, `audit-ledger-vs-sources-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== Livro × fontes BTG ===');
  console.log(`Notas (TXT): ${report.notesParsed}`);
  console.log(`Refs esperadas: ${report.expectedBrokerRefs} | no livro: ${report.ledgerBrokerRefs}`);
  console.log(`Faltando no livro: ${report.missingInLedgerCount}`);
  console.log(`Extras no livro: ${report.extraInLedgerCount}`);
  console.log(`Eventos projetados: ${report.ledgerEvents}`);
  console.log(`PLE: ${report.patrimonyEntries} | FLE: ${report.financialEntries}`);
  console.log(`Saldo caixa (FLE): R$ ${report.cashBalanceFromFinancialLedger.toFixed(2)}`);
  console.log(`\nRelatório: ${outPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
