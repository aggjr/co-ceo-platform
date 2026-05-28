import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM financial_ledger_entries ORDER BY effective_date ASC LIMIT 5`
  );
  console.log(rows);
  await pool.end();
}

main().catch(console.error);
