require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const p = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const org = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
  const [rows] = await p.query(
    `SELECT e.transaction_date, e.transaction_type, a.asset_ticker, e.quantity, e.unit_price, e.total_net_value, e.broker_note_ref, e.notes
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ? AND e.deleted_at IS NULL
       AND (a.asset_ticker = 'ITUB4' OR e.underlying_ticker = 'ITUB4' OR a.asset_ticker LIKE 'ITUB%')
     ORDER BY e.transaction_date, e.created_at`,
    [org]
  );
  for (const r of rows) {
    const d = String(r.transaction_date).slice(0, 10);
    console.log(
      d,
      r.transaction_type.padEnd(16),
      String(r.asset_ticker).padEnd(10),
      'qty',
      r.quantity,
      'px',
      r.unit_price,
      'net',
      r.total_net_value,
      r.broker_note_ref?.slice(0, 40) || ''
    );
  }
  await p.end();
})();
