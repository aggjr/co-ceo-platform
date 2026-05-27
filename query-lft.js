const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT e.transaction_date, a.asset_ticker, e.transaction_type, e.quantity, e.unit_price, e.total_gross_value, e.broker_note_ref, e.notes FROM invest_ledger_entries e JOIN invest_assets a ON e.asset_id = a.id WHERE a.asset_ticker LIKE '%LFT%' ORDER BY e.transaction_date ASC");
  console.table(rows);
  c.end();
}
run().catch(console.error);
