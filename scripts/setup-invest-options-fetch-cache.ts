import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });

  console.log(`Setting up invest_options_fetch_cache table on ${host}...`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invest_options_fetch_cache (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticker VARCHAR(50) NOT NULL,
      quote_date DATE NOT NULL,
      closing_price DECIMAL(15,6) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'FOUND',
      source VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ticker_date (ticker, quote_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('Table created or already exists.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
