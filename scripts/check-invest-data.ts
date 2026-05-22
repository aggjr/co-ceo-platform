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

  const [tesouroLedger] = await pool.query(`
    SELECT a.asset_ticker, l.transaction_type, l.quantity, l.unit_price, l.total_net_value, l.transaction_date
    FROM invest_ledger_entries l
    JOIN invest_assets a ON a.id = l.asset_id
    WHERE a.asset_ticker LIKE '%TESOURO%'
  `);
  console.log("=== ALL TESOURO LEDGER ENTRIES ===");
  console.log(tesouroLedger);

  await pool.end();
}

main().catch(console.error);
