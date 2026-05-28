const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT id, transaction_date, asset_ticker, transaction_type, quantity, unit_price, total_gross_value, total_net_value FROM invest_ledger_entries WHERE asset_ticker = 'TESOURO-SELIC-2031' ORDER BY transaction_date ASC");
  console.table(rows);
  c.end();
}
run().catch(console.error);
