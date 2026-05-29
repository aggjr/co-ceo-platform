import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<any[]>(`SELECT name, account_type FROM financial_accounts`);
  console.log(rows);
  
  await pool.end();
}

main().catch(console.error);
