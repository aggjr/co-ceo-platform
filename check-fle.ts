import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
dotenv.config();

async function main() {
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'Dani160779!', database: 'co_ceo_db' });
  
  const [res] = await pool.query<mysql.RowDataPacket[]>(`
    SELECT a.external_id, 
           SUM(CASE WHEN e.direction='in' THEN e.amount ELSE -e.amount END) as s 
    FROM financial_ledger_entries e 
    JOIN financial_accounts a ON e.account_id = a.id 
    GROUP BY a.external_id
  `);
  console.log(res);
  await pool.end();
}
main().catch(console.error);
