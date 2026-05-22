import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function fix() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db'
  });
  await pool.query('UPDATE organizations SET name = ? WHERE id = ?', ['Holding Financeira Gonçalves', 'org-holding-001']);
  console.log('Done');
  process.exit(0);
}
fix();
