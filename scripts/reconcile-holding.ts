import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

(async () => {
  const org = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const ledger = new LedgerImportService(new CoCeoDataGateway(pool));
  const ctx = { ...installerContext(), organizationId: org, scope: 'node' as const };
  const r = await ledger.reconcileCustody(ctx);
  console.log('reconcile', r);
  const [rows] = await pool.query(
    `SELECT asset_ticker, current_quantity, managerial_avg_price
     FROM invest_assets WHERE organization_id = ? AND asset_ticker IN ('PRIO3','BBAS3','ITUB4','WEGE3','PRIOA407')
     ORDER BY asset_ticker`,
    [org]
  );
  console.log('custody', rows);
  await pool.end();
})();
