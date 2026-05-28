import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query(`
    SELECT snapshot_date, patrimony, external_flow, daily_return_twr, cumulative_twr 
    FROM invest_portfolio_daily 
    WHERE organization_id = 'org-holding-001' 
      AND snapshot_date >= '2026-04-15' AND snapshot_date <= '2026-04-25'
    ORDER BY snapshot_date ASC
  `);
  console.log(rows);
  await pool.end();
}

main().catch(console.error);
