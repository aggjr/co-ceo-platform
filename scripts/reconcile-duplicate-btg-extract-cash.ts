/**
 * Remove lançamentos de caixa duplicados BTG-EXTRACT:* quando já existe par BTG-EXT-*.
 *
 *   npx ts-node scripts/reconcile-duplicate-btg-extract-cash.ts --dry
 *   REMOTE_DB_PASSWORD=... REMOTE_DB_HOST=69.62.99.34 npx ts-node scripts/reconcile-duplicate-btg-extract-cash.ts --apply
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  findBtgExtractCashDuplicates,
  roundCashNet,
} from '../src/core/invest/cashExtractDedup';
import {
  settledCashBalanceFromLedger,
} from '../src/core/invest/cashInvestLedger';
import { PatrimonyDailyStore } from '../src/core/invest/PatrimonyDailyStore';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const TODAY = new Date().toISOString().slice(0, 10);

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dry = process.argv.includes('--dry') || !apply;

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
  const patrimonyStore = new PatrimonyDailyStore(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', TODAY);
  const before = settledCashBalanceFromLedger(events, TODAY);
  const minArg = process.argv.find((a) => a.startsWith('--min='));
  const minAbs = minArg ? Number(minArg.split('=')[1]) : 0.01;
  const duplicates = findBtgExtractCashDuplicates(events, { minAbsAmount: minAbs });
  const removeSum = roundCashNet(duplicates.reduce((s, d) => s + d.net, 0));
  const afterEst = roundCashNet(before - removeSum);

  console.log('=== Reconciliar caixa BTG-EXTRACT duplicado ===');
  console.log('Host:', host, '| Org:', ORG, '| Modo:', dry ? 'DRY-RUN' : 'APPLY');
  console.log('');
  console.log('Saldo liquidado atual:     ', brl(before));
  console.log('Duplicatas EXTRACT+EXT:    ', duplicates.length, 'linhas');
  console.log('Soma a remover (EXTRACT):  ', brl(removeSum));
  console.log('Saldo estimado pós-limpeza:', brl(afterEst));
  console.log('');

  if (!duplicates.length) {
    console.log('Nada a fazer.');
    await pool.end();
    return;
  }

  console.log('--- Candidatos ---');
  for (const d of duplicates) {
    console.log(
      `  ${d.date} ${brl(d.net)} id=${d.extractEventId.slice(0, 8)} EXTRACT=${d.extractRef} twin=${d.twinRef}`
    );
    if (d.notes) console.log(`      ${d.notes.slice(0, 80)}`);
  }

  if (dry) {
    console.log('\nDry-run — use --apply para soft-delete.');
    await pool.end();
    return;
  }

  let minDate = duplicates[0]!.date;
  for (const d of duplicates) {
    if (d.date < minDate) minDate = d.date;
  }

  let voided = 0;
  for (const d of duplicates) {
    await gateway.softDelete(ctx, 'financial_ledger_entries', d.extractEventId);
    voided += 1;
  }

  await patrimonyStore.invalidateFromDate(ctx, minDate);

  const eventsAfter = await ledger.listLedgerEvents(ctx, '2000-01-01', TODAY);
  const after = settledCashBalanceFromLedger(eventsAfter, TODAY);

  console.log('\n--- Resultado ---');
  console.log('Soft-delete FLE:           ', voided);
  console.log('Patrimônio invalidado desde:', minDate);
  console.log('Saldo liquidado após:      ', brl(after));
  console.log('Delta:                     ', brl(roundCashNet(after - before)));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
