/**
 * Reconcilia duplicatas no livro: mesma operação por fingerprint ou número de nota,
 * e risco de caixa em dobro.
 *
 *   npx ts-node scripts/reconcile-duplicate-operations.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  buildLedgerDedupIndex,
  extractBareNoteNumber,
  fingerprintFromLedgerEvent,
} from '../src/core/invest/ledgerOperationDedup';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const OUT_DIR = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');

function isTrade(e: LedgerEvent): boolean {
  if (e.asset_type === 'cash') return false;
  const op = String(e.transaction_type);
  return !['fee', 'opening_balance', 'dividend', 'jcp'].includes(op);
}

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password && host === '127.0.0.1') {
    console.error(
      'Defina DB_PASSWORD no .env (local) ou REMOTE_DB_PASSWORD + REMOTE_DB_HOST (servidor).'
    );
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
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const trades = events.filter(isTrade);

  const byFp = new Map<string, LedgerEvent[]>();
  const byNote = new Map<string, LedgerEvent[]>();

  for (const e of trades) {
    const fp = fingerprintFromLedgerEvent(e);
    const list = byFp.get(fp) || [];
    list.push(e);
    byFp.set(fp, list);

    const bare = extractBareNoteNumber(e.broker_note_ref);
    if (bare) {
      const nl = byNote.get(bare) || [];
      nl.push(e);
      byNote.set(bare, nl);
    }
  }

  const fpDupes = [...byFp.entries()].filter(([, list]) => list.length > 1);
  const noteDupes = [...byNote.entries()].filter(([, list]) => {
    const refs = new Set(list.map((e) => e.broker_note_ref));
    return refs.size > 1;
  });

  const cashDoubleRisk: Array<{
    fingerprint: string;
    refs: string[];
    cashAmounts: number[];
  }> = [];

  for (const [fp, list] of fpDupes) {
    const refs = [...new Set(list.map((e) => e.broker_note_ref).filter(Boolean))];
    const cashAmounts: number[] = [];
    for (const ref of refs) {
      const cash = events.find(
        (e) =>
          e.asset_type === 'cash' &&
          (e.broker_note_ref === ref || e.broker_note_ref === `${ref}:CASH`)
      );
      if (cash) {
        cashAmounts.push(Math.abs(Number(cash.total_net_value) || 0));
      }
    }
    if (cashAmounts.length > 1) {
      cashDoubleRisk.push({ fingerprint: fp, refs: refs as string[], cashAmounts });
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = path.join(
    OUT_DIR,
    `reconcile-duplicatas-${today}.json`
  );
  const report = {
    generatedAt: new Date().toISOString(),
    organizationId: ORG_ID,
    tradeLines: trades.length,
    fingerprintDuplicateGroups: fpDupes.length,
    noteNumberAliasGroups: noteDupes.length,
    cashDoubleRisk,
    samples: {
      fingerprintDuplicates: fpDupes.slice(0, 15).map(([fp, list]) => ({
        fingerprint: fp,
        count: list.length,
        refs: list.map((e) => ({
          ref: e.broker_note_ref,
          id: e.id,
          date: e.transaction_date,
          ticker: e.asset_ticker,
          qty: e.quantity,
          price: e.unit_price,
        })),
      })),
      noteAliases: noteDupes.slice(0, 15).map(([note, list]) => ({
        noteNumber: note,
        refs: [...new Set(list.map((e) => e.broker_note_ref))],
      })),
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Operações patrimoniais: ${trades.length}`);
  console.log(`Grupos com mesma fingerprint (qty×preço×data): ${fpDupes.length}`);
  console.log(`Notas com mais de um broker_note_ref: ${noteDupes.length}`);
  console.log(`Risco de caixa em dobro (≥2 refs com caixa): ${cashDoubleRisk.length}`);
  if (cashDoubleRisk.length) {
    console.log('\nAmostras caixa duplicado:');
    for (const r of cashDoubleRisk.slice(0, 8)) {
      console.log(`  ${r.fingerprint}`);
      console.log(`    refs: ${r.refs.join(' | ')}`);
      console.log(`    valores caixa: ${r.cashAmounts.map((v) => v.toFixed(2)).join(', ')}`);
    }
  }
  console.log(`\nRelatório: ${reportPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
