const mysql = require('mysql2/promise');
const fs = require('fs');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT * FROM invest_ledger_entries");
  fs.writeFileSync('ledger_rows.json', JSON.stringify(rows, null, 2));
  c.end();
}
run().catch(console.error);
