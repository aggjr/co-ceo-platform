/**
 * Lança no livro razão opções pendentes do snapshot importado (aguardando notas).
 *
 *   npm run import:broker:snapshot -- local-import/btg-sources/custody-snapshot.json
 *   npm run apply:broker:options-ledger
 *   npm run apply:broker:options-ledger -- 2026-05-23
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { BrokerCustodySnapshotRepository } from '../src/core/invest/BrokerCustodySnapshotRepository';
import {
  buildPendingLedgerLinesFromSnapshot,
  pendingEventRefForDate,
} from '../src/core/invest/buildPendingLedgerFromSnapshot';
import { applyBrokerHoldingSnapshot } from '../src/core/invest/applyBrokerHoldingSnapshot';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const repo = new BrokerCustodySnapshotRepository(gateway);
  const ledger = new LedgerImportService(gateway);

  const snapshot =
    (dateArg ? await repo.loadByReferenceDate(ctx, dateArg) : null) ??
    (await repo.loadLatest(ctx));
  if (!snapshot) {
    throw new Error(
      'Nenhum snapshot no banco. Rode: npm run import:broker:snapshot -- <arquivo.json>'
    );
  }

  const entries = buildPendingLedgerLinesFromSnapshot(snapshot);
  const ref = pendingEventRefForDate(snapshot.referenceDate);

  console.log('=== Lançamentos provisórios (snapshot banco) ===\n');
  console.log('Data:', snapshot.referenceDate);
  console.log('Header:', ref);
  console.log('Linhas:', entries.length);
  for (const e of entries) {
    console.log(
      `  ${e.ticker.padEnd(12)} ${String(e.operation).padEnd(10)} qty=${String(e.quantity).padStart(6)} @ ${e.unit_price}`
    );
  }
  console.log('');

  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'Snapshot BTG — aguardando notas',
  });
  console.log('Import:', result);

  console.log('\n--- Marcas de mercado (snapshot) ---');
  const snap = await applyBrokerHoldingSnapshot(gateway, ORG, snapshot.referenceDate);
  console.log('Posições tocadas:', snap.positionsTouched, '| faltantes:', snap.positionsMissing.join(', ') || '(nenhum)');

  const recorder = new PatrimonyDailyRecorder(gateway);
  const saved = await recorder.recordDay(ctx, snapshot.referenceDate);
  console.log('\nPatrimônio gravado:', saved.recorded.patrimony.toLocaleString('pt-BR'));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
