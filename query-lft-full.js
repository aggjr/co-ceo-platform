const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT * FROM invest_ledger_entries e LEFT JOIN invest_assets a ON e.asset_id = a.id WHERE a.asset_ticker LIKE '%LFT%' OR a.asset_ticker LIKE '%TESOURO%'");
  console.table(rows);
  c.end();
}
run().catch(console.error);
