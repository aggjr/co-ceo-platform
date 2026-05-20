/**
 * Aplica correções autorizadas (CDB, extrato 18–19/05, PRIOF, saldo caixa).
 * Uso: npx ts-node scripts/invest-apply-corrections.ts
 */
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../src/core/dal';
import { CustodyCorrectionService } from '../src/core/invest/CustodyCorrectionService';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { installerContext } from '../src/database/seeds/lib/installerContext';

import mysql from 'mysql2/promise';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const corrections = new CustodyCorrectionService(gateway, ledger);
  const result = await corrections.applyAuthorizedCorrections(ctx);
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
