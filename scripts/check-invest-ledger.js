require('dotenv').config();
const mysql = require('mysql2/promise');

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const [[{ n: total }]] = await conn.query(
    'SELECT COUNT(1) AS n FROM invest_ledger_entries WHERE organization_id = ?',
    [ORG]
  );
  const [assets] = await conn.query(
    'SELECT asset_ticker, current_quantity, status FROM invest_assets WHERE organization_id = ? ORDER BY asset_ticker',
    [ORG]
  );
  const [openings] = await conn.query(
    `SELECT a.asset_ticker, e.transaction_type, e.quantity, e.unit_price
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ? AND e.transaction_date = '2026-01-01'
     ORDER BY a.asset_ticker`,
    [ORG]
  );
  console.log(JSON.stringify({ total, assets, openings }, null, 2));
  await conn.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
