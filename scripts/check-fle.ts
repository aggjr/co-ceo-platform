import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [fle] = await conn.query("SELECT transaction_date, amount, description FROM financial_ledger_entries WHERE transaction_date = '2026-01-01'");
  console.log('FLE:', fle);
  
  const [sum] = await conn.query("SELECT SUM(amount) as s FROM financial_ledger_entries WHERE transaction_date = '2026-01-01'");
  console.log('SUM:', (sum as any)[0].s);

  await conn.end();
}
main().catch(console.error);
