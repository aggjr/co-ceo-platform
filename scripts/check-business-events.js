require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: 'co_ceo_platform',
  });
  const [tbls] = await conn.query(`SHOW TABLES LIKE 'business_events'`);
  console.log('business_events:', tbls.length ? 'OK' : 'MISSING');
  const [cols] = await conn.query(`SHOW COLUMNS FROM business_events`);
  console.log(`  ${cols.length} colunas`);
  const [pCols] = await conn.query(`SHOW COLUMNS FROM patrimony_ledger_entries LIKE 'business_event_id'`);
  console.log('patrimony_ledger_entries.business_event_id:', pCols.length ? 'OK' : 'MISSING');
  const [fCols] = await conn.query(`SHOW COLUMNS FROM financial_ledger_entries LIKE 'business_event_id'`);
  console.log('financial_ledger_entries.business_event_id:', fCols.length ? 'OK' : 'MISSING');
  const [count] = await conn.query(`SELECT COUNT(*) AS n FROM business_events`);
  console.log(`business_events: ${count[0].n} rows`);
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
