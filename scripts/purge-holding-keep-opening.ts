/**
 * CLI para purge da holding (preserva abertura). Lógica em HoldingPurgeKeepOpeningService.
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD="..."; $env:REMOTE_DB_HOST="69.62.99.34"
 *   npx ts-node scripts/purge-holding-keep-opening.ts --dry-run
 *   npx ts-node scripts/purge-holding-keep-opening.ts --confirm
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { HoldingPurgeKeepOpeningService } from '../src/core/invest/HoldingPurgeKeepOpeningService';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

function dbConfig() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina REMOTE_DB_PASSWORD ou DB_PASSWORD.');
    process.exit(1);
  }
  return {
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4' as const,
  };
}

async function main() {
  if (!DRY_RUN && !CONFIRM) {
    console.error('Use --dry-run para simular ou --confirm para executar o purge.');
    process.exit(1);
  }

  const cfg = dbConfig();
  const pool = mysql.createPool({ ...cfg, waitForConnections: true, connectionLimit: 4 });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const service = new HoldingPurgeKeepOpeningService(gateway, pool);

  const pf = await service.preflight(ctx);
  console.log(`Org: ${ORG} @ ${cfg.host}/${cfg.database}`);
  console.log(`Abertura: ${pf.openingDate} (${pf.openingRef})`);
  console.log(`Precisa escolha de modo: ${pf.needsDataModeChoice}`);

  if (pf.purgePreview) {
    const p = pf.purgePreview;
    console.log('\nPreview:');
    console.log('  patrimony_ledger a remover:', p.patrimonyLegsToRemove);
    console.log('  financial_ledger a remover:', p.financialLegsToRemove);
    console.log('  business_events a remover:', p.businessEventsToRemove);
    for (const [t, n] of Object.entries(p.auxRowsToRemove)) {
      if (n > 0) console.log(`  ${t}:`, n);
    }
  }

  if (DRY_RUN) {
    await pool.end();
    return;
  }

  const result = await service.purgeKeepOpening(ctx);
  console.log('\nExecutado:');
  console.log('  patrimony_ledger removidos:', result.patrimonyLegsRemoved);
  console.log('  financial_ledger removidos:', result.financialLegsRemoved);
  console.log('  business_events removidos:', result.businessEventsRemoved);
  console.log('  reconcileCustody:', result.reconcileCustody);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
