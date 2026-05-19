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
  const [pending] = await conn.query(
    `SELECT transaction_date, total_net_value, notes, broker_note_ref
     FROM invest_ledger_entries
     WHERE organization_id = ? AND transaction_type = 'pending_settlement'
     ORDER BY transaction_date DESC`,
    [ORG]
  );
  console.log('pending_settlement rows:', JSON.stringify(pending, null, 2));
  await conn.end();
})();
