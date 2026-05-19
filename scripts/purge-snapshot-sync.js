require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [r] = await c.query(
    "DELETE FROM invest_ledger_entries WHERE organization_id='org-holding-001' AND broker_note_ref LIKE 'BTG-SNAPSHOT-STOCK-SYNC%'"
  );
  console.log('deleted', r.affectedRows);
  await c.end();
})();
