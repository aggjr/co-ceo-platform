/**
 * Remove import anterior de exercícios BTG 15/05 para permitir reimport limpo.
 */
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
  const [r1] = await conn.query(
    `DELETE FROM invest_ledger_entries
     WHERE organization_id = ? AND broker_note_ref LIKE 'BTG-EXERCISE-2026-05-15%'`,
    [ORG]
  );
  const [r2] = await conn.query(
    `DELETE FROM invest_ledger_entries
     WHERE organization_id = ? AND broker_note_ref LIKE 'AUTO-D2:%'`,
    [ORG]
  );
  console.log('deleted exercises', r1.affectedRows, 'auto-d2', r2.affectedRows);
  await conn.end();
})();
