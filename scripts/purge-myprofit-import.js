require('dotenv').config();
const mysql = require('mysql2/promise');

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [res] = await c.query(
    `DELETE FROM invest_ledger_entries
     WHERE organization_id = ?
       AND broker_note_ref LIKE 'B3_%'
       AND broker_note_ref <> 'OPENING-MYPROFIT-2025-12-31'`,
    [ORG]
  );
  console.log('Deleted myProfit note rows:', res.affectedRows);
  await c.end();
})();
