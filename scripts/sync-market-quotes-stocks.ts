/**
 * Sincroniza cotações de fechamento (brapi) para todos os tickers de ações/FIIs/ETF/BDR
 * em uso por qualquer cliente, gravando em market_quotes_daily (global).
 *
 * Uso:
 *   npm run sync:market:quotes:stocks
 *   npm run sync:market:quotes:stocks -- 2026-05-20
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { StockMarketSyncService } from '../src/core/market/StockMarketSyncService';

dotenv.config();

const dateArg = process.argv[2]?.slice(0, 10);

async function main() {
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const report = await new StockMarketSyncService(gateway).syncFromBrapi(ctx, dateArg);

  console.log(JSON.stringify(report, null, 2));
  if (report.missing.length) {
    console.log('Sem cotação:', report.missing.join(', '));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
