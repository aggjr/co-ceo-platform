import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query(`
    SELECT transaction_date, movement_type, total_value, notes, asset_ticker 
    FROM patrimony_ledger_entries 
    WHERE organization_id = 'org-holding-001' 
      AND movement_type IN ('capital_deposit', 'capital_withdrawal')
    ORDER BY transaction_date ASC
  `);
  console.log(rows);
  await pool.end();
}
main().catch(console.error);
