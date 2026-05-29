import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
dotenv.config();

async function main() {
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'Dani160779!', database: 'co_ceo_db' });
  const [accs] = await pool.query('SELECT * FROM financial_accounts');
  console.log(accs);
  await pool.end();
}
main().catch(console.error);
