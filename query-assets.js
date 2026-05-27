const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT * FROM invest_assets WHERE asset_type = 'fixed_income' OR asset_ticker LIKE '%LFT%'");
  console.table(rows);
  c.end();
}
run().catch(console.error);
