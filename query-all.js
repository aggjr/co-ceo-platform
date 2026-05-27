const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT e.transaction_date, e.asset_id, e.transaction_type, e.quantity, e.unit_price, e.total_gross_value, e.broker_note_ref, e.notes FROM invest_ledger_entries e ORDER BY e.transaction_date ASC");
  console.table(rows);
  c.end();
}
run().catch(console.error);
