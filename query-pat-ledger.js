const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query(`
    SELECT pl.transaction_date, pl.movement_type, pl.quantity_delta, pl.unit_value, pl.total_value, i.identifier 
    FROM patrimony_ledger_entries pl
    JOIN patrimony_items i ON pl.patrimony_item_id = i.id
    WHERE i.identifier LIKE '%TESOURO%'
    ORDER BY pl.transaction_date ASC
  `);
  console.table(rows);
  c.end();
}
run().catch(console.error);
