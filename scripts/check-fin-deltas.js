import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query(`
    SELECT transaction_date, direction, amount, description 
    FROM financial_ledger_entries 
    WHERE organization_id = 'org-holding-001' 
      AND description LIKE 'Ajuste manual de caixa%'
    ORDER BY transaction_date ASC
  `);
  console.log(rows);
  await pool.end();
}

main().catch(console.error);
