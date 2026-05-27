const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT transaction_date, transaction_type, quantity, unit_price, total_gross_value, broker_note_ref, notes FROM invest_ledger_entries WHERE asset_id = '26defe08-c129-4a54-936a-7f3fa31a97fd' ORDER BY transaction_date ASC");
  console.table(rows);
  c.end();
}
run().catch(console.error);
