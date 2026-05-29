import { config } from 'dotenv';
config();
import { CoCeoDataGateway } from './src/core/dal';
import { MarketQuoteRepository } from './src/core/market/MarketQuoteRepository';
import { authBootstrapContext } from './src/core/auth/authBootstrapContext';
import mysql from 'mysql2/promise';

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool);
  const repo = new MarketQuoteRepository(gateway);
  try {
    const ctx = authBootstrapContext();
    const map = await repo.loadLatestQuoteMap(ctx, ['PETR4', 'ITUB4']);
    console.log(map);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
