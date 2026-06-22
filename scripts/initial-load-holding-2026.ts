/**
 * Carga inicial holding org-holding-001 — jan–jun/2026 a partir de co_ceo_platform (dados).
 *
 * Fluxo:
 *   1. Verifica pasta (dados) — extratos + notas
 *   2. (--reset) zera tabelas INVEST da org + abertura 01/01/2026
 *   3. Reimporta BTG mês a mês (notas → extrato)
 *   4. Backfill invest_portfolio_daily
 *
 *   npx ts-node scripts/initial-load-holding-2026.ts
 *   npx ts-node scripts/initial-load-holding-2026.ts --reset
 *   npx ts-node scripts/initial-load-holding-2026.ts --skip-import
 *   npx ts-node scripts/initial-load-holding-2026.ts --skip-backfill
 *   npx ts-node scripts/initial-load-holding-2026.ts --from 2026-03
 */
import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { createInvestPool, requireDbPassword } from './lib/invest-db-pool';
import { verifyBtgDadosLayout } from './lib/btg-2026-months';
import { runBackfillPatrimonyDaily } from './backfill-daily-patrimony';

dotenv.config();

const ROOT = path.join(__dirname, '..');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

const RESET = process.argv.includes('--reset');
const SKIP_IMPORT = process.argv.includes('--skip-import');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');
const FORCE = process.argv.includes('--force');
const FROM =
  process.argv.find((a) => a.startsWith('--from='))?.slice(7) ||
  (process.argv.includes('--from')
    ? process.argv[process.argv.indexOf('--from') + 1]
    : undefined) ||
  '2026-01';

function runScript(rel: string, args: string[] = []): void {
  const cmd = `npx ts-node ${rel} ${args.join(' ')}`.trim();
  console.log(`\n> ${cmd}`);
  const env = { ...process.env };
  if (!env.REMOTE_DB_PASSWORD && env.DB_PASSWORD) env.REMOTE_DB_PASSWORD = env.DB_PASSWORD;
  if (!env.REMOTE_DB_HOST && env.DB_HOST) env.REMOTE_DB_HOST = env.DB_HOST;
  if (!env.REMOTE_DB_NAME && env.DB_NAME) env.REMOTE_DB_NAME = env.DB_NAME;
  if (!env.REMOTE_DB_USER && env.DB_USER) env.REMOTE_DB_USER = env.DB_USER;
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, env });
}

async function hasOpening(pool: mysql.Pool): Promise<boolean> {
  const [[row]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM patrimony_ledger_entries
     WHERE organization_id = ? AND movement_type = 'opening_balance'
       AND transaction_date = '2026-01-01' AND deleted_at IS NULL`,
    [ORG]
  );
  return Number(row?.c ?? 0) > 0;
}

async function main() {
  requireDbPassword();

  console.log('=== Carga inicial holding jan–jun/2026 ===');
  console.log(`Org: ${ORG}`);
  console.log(`From: ${FROM}`);
  console.log(`Reset: ${RESET ? 'sim' : 'não'} | Import: ${SKIP_IMPORT ? 'pular' : 'sim'} | Backfill: ${SKIP_BACKFILL ? 'pular' : 'sim'}`);

  const layout = verifyBtgDadosLayout();
  console.log(`\nPasta dados: ${layout.base}`);
  console.log(`Notas encontradas: ${layout.noteCount}`);
  if (!layout.ok) {
    console.error('\nArquivos ausentes:');
    for (const m of layout.missing) console.error(`  - ${m}`);
    console.error('\nDefina BTG_DADOS_DIR ou coloque os PDFs no layout canônico.');
    process.exit(1);
  }

  if (RESET) {
    console.log('\n--- Reset INVEST (hard delete org) ---');
    runScript('scripts/reset-invest-tables.js', ['--confirm']);
  }

  const pool = createInvestPool();
  try {
    const openingExists = await hasOpening(pool);
    if (!openingExists) {
      console.log('\n--- Abertura 01/01/2026 ---');
      runScript('scripts/import-opening-2026-01-01.ts');
    } else {
      console.log('\nAbertura 01/01/2026 já presente — pulando import-opening.');
    }

    if (!SKIP_IMPORT) {
      const importArgs = ['--apply', `--from=${FROM}`];
      if (FORCE) importArgs.push('--force');
      if (SKIP_BACKFILL) importArgs.push('--skip-backfill');
      runScript('scripts/reimport-btg-months-2026.ts', importArgs);
    } else if (!SKIP_BACKFILL) {
      console.log('\n--- Backfill patrimônio (sem reimport) ---');
      await runBackfillPatrimonyDaily(pool, '2026-01-01', ORG);
    }

    const [[countRow]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c, MIN(snapshot_date) AS min_d, MAX(snapshot_date) AS max_d
       FROM invest_portfolio_daily WHERE organization_id = ?`,
      [ORG]
    );
    console.log('\n=== Resumo final ===');
    console.log(
      `invest_portfolio_daily: ${countRow?.c ?? 0} linha(s)` +
        (countRow?.min_d ? ` (${countRow.min_d} → ${countRow.max_d})` : '')
    );
    const [[ledgerRow]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM patrimony_ledger_entries WHERE organization_id = ?`,
      [ORG]
    );
    console.log(`patrimony_ledger_entries: ${ledgerRow?.c ?? 0} linha(s)`);
    console.log('\nCarga inicial concluída. Melhorias de classificação/LIQ podem ser feitas depois.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
