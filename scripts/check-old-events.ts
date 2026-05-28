import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query(
    `SELECT transaction_date, operation, total_net_value, broker_note_ref 
     FROM financial_ledger_entries 
     WHERE transaction_date < '2026-01-01' AND asset_type = 'cash'`
  );
  
  console.log('Events before 2026:');
  console.log(rows);
  
  await pool.end();
}

main().catch(console.error);
