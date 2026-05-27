/**
 * Atualiza cotações ao vivo (brapi regularMarketPrice) na holding + market_quotes_daily.
 * Uso: npx ts-node scripts/sync-holding-live-quotes.ts [org-id]
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { InvestQuoteSyncService } from '../src/core/invest/InvestQuoteSyncService';

dotenv.config();

async function main() {
  const org = process.argv[2]?.trim() || process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: org, scope: 'node' as const };
  const result = await new InvestQuoteSyncService(gateway).syncFromBrapi(ctx);
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
