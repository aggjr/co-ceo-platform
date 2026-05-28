import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
dotenv.config();

async function main() {
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'Dani160779!', database: 'co_ceo_db' });
  await pool.query('DELETE FROM financial_ledger_entries WHERE external_ref LIKE "MANUAL-ADJ-%"');
  console.log('Deleted');
  await pool.end();
}
main().catch(console.error);
