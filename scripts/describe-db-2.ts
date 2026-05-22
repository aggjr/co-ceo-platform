import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const [ledger] = await pool.query('DESCRIBE invest_ledger_entries');
  console.log("=== invest_ledger_entries ===");
  console.log(ledger);
  
  const [entries] = await pool.query('SELECT * FROM invest_ledger_entries WHERE asset_ticker = "PRIO3" OR asset_ticker LIKE "PRIOF%"');
  console.log("=== PRIO3 ENTRIES ===");
  console.log(entries);

  await pool.end();
}

main().catch(console.error);
