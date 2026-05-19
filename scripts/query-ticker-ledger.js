require('dotenv').config();
const mysql = require('mysql2/promise');

const tickers = process.argv.slice(2);
const ORG = 'org-holding-001';

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [rows] = await c.query(
    `SELECT a.asset_ticker, e.transaction_date, e.transaction_type, e.quantity, e.unit_price, e.broker_note_ref
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ? AND a.asset_ticker IN (?)
     ORDER BY e.transaction_date`,
    [ORG, tickers]
  );
  console.log(rows);
  await c.end();
})();
