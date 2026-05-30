const mysql = require('mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db',
  });

  // Check foreign key constraints on financial_ledger_entries
  const [fks] = await pool.query(`
    SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE REFERENCED_TABLE_SCHEMA = 'co_ceo_db'
    AND TABLE_NAME IN ('financial_ledger_entries', 'patrimony_ledger_entries', 'patrimony_items', 'business_events', 'financial_accounts')
    ORDER BY TABLE_NAME
  `);
  console.log('Foreign keys:');
  fks.forEach(r => console.log(`  ${r.TABLE_NAME}.${r.COLUMN_NAME} -> ${r.REFERENCED_TABLE_NAME}.${r.REFERENCED_COLUMN_NAME} [${r.CONSTRAINT_NAME}]`));

  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
