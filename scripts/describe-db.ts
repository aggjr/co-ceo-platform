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

  const [tables] = await pool.query('SHOW TABLES');
  console.log(tables);

  const [assets] = await pool.query('DESCRIBE invest_assets');
  console.log("=== invest_assets ===");
  console.log(assets);

  const [ledger] = await pool.query('DESCRIBE invest_ledger');
  console.log("=== invest_ledger ===");
  console.log(ledger);

  await pool.end();
}

main().catch(console.error);
