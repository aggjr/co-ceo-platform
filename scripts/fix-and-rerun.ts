import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { execSync } from 'child_process';

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

  console.log("=== DELETING WRONG LEDGER ENTRIES ===");
  await pool.query(`DELETE FROM invest_ledger_entries WHERE broker_note_ref LIKE 'BTG-EXT-20260518-%' OR broker_note_ref LIKE 'BTG-EXT-20260519-%'`);
  
  await pool.end();
  
  console.log("=== RUNNING CORRECTIONS SCRIPT AGAIN ===");
  execSync('npx ts-node scripts/invest-apply-corrections.ts', { stdio: 'inherit' });
}

main().catch(console.error);
