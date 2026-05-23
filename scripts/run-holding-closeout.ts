/**
 * Fechamento holding: sincroniza 3 preços, reconcileCustody, validação e batimento.
 *
 *   npx ts-node scripts/run-holding-closeout.ts
 *   npx ts-node scripts/run-holding-closeout.ts --dry-run
 */
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const dryRun = process.argv.includes('--dry-run');

function run(label: string, cmd: string) {
  console.log(`\n--- ${label} ---\n`);
  execSync(cmd, { cwd: process.cwd(), stdio: 'inherit', shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' });
}

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  console.log(`=== Closeout holding @ ${host} ${dryRun ? '(dry-run)' : ''} ===`);

  if (!dryRun) {
    run('Sync PM ext (ações)', 'npx ts-node scripts/sync-position-ext-three-prices.ts');
    run('Validação 3 preços', 'npx ts-node scripts/validate-three-prices-holding.ts');
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);

  if (!dryRun) {
    const rec = await ledger.reconcileCustody(ctx);
    console.log('\nreconcileCustody:', rec);
  }

  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const prices = computeThreePricesByUnderlying(events);

  console.log('\n=== PM triplo (posições abertas) ===');
  for (const key of ['PRIO3', 'ITUB4', 'BBAS3', 'WEGE3', 'LFT-20310301']) {
    const row = prices.get(key);
    if (!row || row.qty <= 0) {
      console.log(`${key}: sem lote`);
      continue;
    }
    console.log(
      `${key}: qty=${row.qty} E=${row.estrito.toFixed(4)} B3=${row.b3.toFixed(4)} G=${row.gerencial.toFixed(4)}`
    );
  }

  const lftCosts = events.filter(
    (e) =>
      String(e.asset_ticker || '').includes('LFT') &&
      String(e.transaction_type) === 'cost_adjustment' &&
      Math.abs(Number(e.total_net_value ?? 0)) > 0.005
  );
  const lftSum = lftCosts.reduce((s, e) => s + Math.abs(Number(e.total_net_value ?? 0)), 0);
  console.log(`\nLFT cost_adjustment no livro: ${lftCosts.length} lançamentos, R$ ${lftSum.toFixed(2)}`);

  const [cashRow] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) saldo
     FROM financial_ledger_entries
     WHERE organization_id = ? AND deleted_at IS NULL`,
    [ORG]
  );
  console.log(`Saldo caixa (FLE): R$ ${Number(cashRow[0]?.saldo ?? 0).toFixed(2)}`);
  console.log(`Eventos livro: ${events.length}`);

  await pool.end();
  console.log('\nCloseout concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
