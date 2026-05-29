import { config } from 'dotenv';
config();
import db from './src/config/database';

async function run() {
  try {
    const [rows] = await db.query("SELECT quote_date FROM market_quotes_daily LIMIT 1");
    const first = (rows as any)[0];
    console.log(first.quote_date);
    console.log(typeof first.quote_date);
    console.log(first.quote_date instanceof Date);
    console.log(String(first.quote_date));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
