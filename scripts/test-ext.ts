import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query(
    `SELECT i.identifier, ext.pm_estrito, ext.pm_b3, ext.pm_gerencial 
     FROM patrimony_items i 
     LEFT JOIN invest_position_ext ext ON i.id = ext.patrimony_item_id 
     WHERE i.organization_id = 'org-holding-001' AND i.status = 'active'
     AND i.identifier IN ('ITUB4', 'BBAS3', 'WEGE3', 'PRIO3')`
  );
  console.log(rows);
  
  await pool.end();
}

main().catch(console.error);
