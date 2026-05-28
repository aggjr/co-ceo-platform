import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<any[]>(
    `SELECT identifier, asset_class, quantity, current_value FROM patrimony_items WHERE organization_id = 'org-holding-001' AND status = 'active'`
  );
  
  for (const r of rows) {
    if (r.identifier === 'CAIXA-BTG') continue;
    console.log(`${r.identifier.padEnd(20)} | ${r.asset_class.padEnd(15)} | Qty: ${r.quantity} | Val: ${r.current_value}`);
  }
  
  await pool.end();
}

main().catch(console.error);
