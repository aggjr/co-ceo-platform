const mysql = require('mysql2/promise');
async function run() {
  const c = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'});
  const [rows] = await c.query("SELECT e.*, a.asset_ticker as a_ticker, a.current_price as a_price FROM invest_ledger_entries e JOIN invest_assets a ON e.asset_id = a.id WHERE a.asset_ticker LIKE '%TESOURO%'");
  
  function nominalGross(e) {
    return Math.round(Math.abs(Number(e.quantity) || 0) * Math.abs(Number(e.unit_price) || 0) * 100) / 100;
  }
  
  for (const e of rows) {
    console.log(`${e.transaction_date} | ${e.transaction_type} | qty=${e.quantity} | px=${e.unit_price} | net=${e.total_net_value} | gross=${nominalGross(e)}`);
  }
  c.end();
}
run().catch(console.error);
