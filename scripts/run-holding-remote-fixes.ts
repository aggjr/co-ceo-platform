/**
 * Pipeline de correção holding no MySQL de produção (REMOTE/DB_HOST).
 *
 *   npx ts-node scripts/run-holding-remote-fixes.ts
 *   npx ts-node scripts/run-holding-remote-fixes.ts --dry-run
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  const database = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  console.log(`=== Holding fixes @ ${host} / ${database} / ${ORG} ${dryRun ? '(dry-run)' : ''} ===\n`);

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database,
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  // 1) Caixa duplicado 01/01
  const [cashOpen] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, description, amount, external_ref, deleted_at
     FROM financial_ledger_entries
     WHERE organization_id = ? AND transaction_date = '2026-01-01'
       AND direction = 'in' AND ABS(amount - 58758.79) < 0.02
     ORDER BY external_ref`,
    [ORG]
  );
  console.log('Caixa 01/01/2026:', cashOpen.length, 'linha(s)');
  for (const r of cashOpen) {
    console.log(`  ${r.deleted_at ? 'DEL' : 'ATV'} ${r.id} ref=${r.external_ref || '—'} ${r.description}`);
  }
  const toRemoveCash = cashOpen.filter(
    (r) => !r.deleted_at && !String(r.external_ref || '').includes('BTG-EXTRATO-OPENING')
  );
  for (const r of toRemoveCash) {
    console.log(`${dryRun ? '[dry-run]' : 'Removendo'} caixa manual: ${r.id}`);
    if (!dryRun) await gateway.softDelete(ctx, 'financial_ledger_entries', String(r.id));
  }

  // 2) reconcileCustody
  const ledger = new LedgerImportService(gateway);
  if (!dryRun) {
    const rec = await ledger.reconcileCustody(ctx);
    console.log('\nreconcileCustody:', rec);
  }

  // 3) Verificação PM PRIO3
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const prices = computeThreePricesByUnderlying(events);
  const prio = prices.get('PRIO3');
  console.log('\nPRIO3 engine:', prio ?? 'sem lote');

  const [optExt] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT pi.identifier, ioe.strike_price, ioe.expiration_date
     FROM invest_option_ext ioe
     JOIN patrimony_items pi ON pi.id = ioe.patrimony_item_id
     WHERE ioe.organization_id = ? AND pi.identifier IN ('PRIOQ43','PRIOR407','PRIOA407')`,
    [ORG]
  );
  console.log('\nStrikes opções abertura:');
  for (const r of optExt) {
    console.log(`  ${r.identifier} strike=${r.strike_price} exp=${r.expiration_date}`);
  }

  const [activeCash] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) c FROM financial_ledger_entries
     WHERE organization_id = ? AND transaction_date = '2026-01-01'
       AND direction = 'in' AND deleted_at IS NULL AND ABS(amount - 58758.79) < 0.02`,
    [ORG]
  );
  console.log(`\nCaixa 01/01 ativos: ${activeCash[0]!.c} (esperado: 1)`);

  await pool.end();
  console.log('\nConcluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
