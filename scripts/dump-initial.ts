import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<any[]>(
    `SELECT identifier, quantity FROM patrimony_items WHERE quantity < 0 AND status = 'active'`
  );
  
  const initialPositions = rows.map(r => ({
    identifier: r.identifier,
    initialQuantity: Math.abs(parseFloat(r.quantity))
  }));
  
  console.log(JSON.stringify(initialPositions, null, 2));
  await pool.end();
}

main().catch(console.error);
