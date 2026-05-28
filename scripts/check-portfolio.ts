import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<any[]>(
    `SELECT identifier, quantity, current_value FROM patrimony_items WHERE organization_id = 'org-holding-001' AND status = 'active'`
  );
  
  for (const r of rows) {
    if (r.identifier === 'CAIXA-BTG') continue;
    const q = Number(r.quantity);
    const v = Number(r.current_value || 1);
    console.log(`${r.identifier.padEnd(20)} | Qty: ${q.toFixed(2).padStart(15)} | Val: ${v.toFixed(2).padStart(15)} | Tot: ${(q*v).toFixed(2).padStart(20)}`);
  }
  
  await pool.end();
}

main().catch(console.error);
