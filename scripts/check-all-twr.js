import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query(`
    SELECT snapshot_date, cumulative_twr 
    FROM invest_portfolio_daily 
    WHERE organization_id = 'org-holding-001' 
    ORDER BY snapshot_date ASC
  `);
  console.log(rows);
  await pool.end();
}

main().catch(console.error);
