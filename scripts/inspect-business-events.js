require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
  });

  const [headers] = await conn.query(
    `SELECT id, organization_id, source_module, event_kind, occurred_on,
            source_ref, total_net, source_system, revision_no, voided_at,
            created_at
     FROM business_events
     ORDER BY created_at DESC
     LIMIT 50`
  );
  console.log('===== HEADERS =====');
  console.log(JSON.stringify(headers, null, 2));

  const [pOrphan] = await conn.query(
    `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
     WHERE business_event_id IS NULL AND deleted_at IS NULL`
  );
  const [fOrphan] = await conn.query(
    `SELECT COUNT(*) AS n FROM financial_ledger_entries
     WHERE business_event_id IS NULL AND deleted_at IS NULL`
  );
  const [pLinked] = await conn.query(
    `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
     WHERE business_event_id IS NOT NULL AND deleted_at IS NULL`
  );
  const [fLinked] = await conn.query(
    `SELECT COUNT(*) AS n FROM financial_ledger_entries
     WHERE business_event_id IS NOT NULL AND deleted_at IS NULL`
  );
  console.log('===== ORPHAN VS LINKED =====');
  console.log(`patrimony_ledger:   orphan=${pOrphan[0].n}   linked=${pLinked[0].n}`);
  console.log(`financial_ledger:   orphan=${fOrphan[0].n}   linked=${fLinked[0].n}`);

  const [byDate] = await conn.query(
    `SELECT transaction_date, movement_type, COUNT(*) AS n
     FROM patrimony_ledger_entries
     WHERE business_event_id IS NULL AND deleted_at IS NULL
     GROUP BY transaction_date, movement_type
     ORDER BY transaction_date ASC, movement_type
     LIMIT 30`
  );
  console.log('===== PATRIMONY ORPHANS BY DATE =====');
  for (const r of byDate) {
    console.log(`  ${r.transaction_date} | ${r.movement_type} | ${r.n}`);
  }

  const [fByDate] = await conn.query(
    `SELECT transaction_date, description, COUNT(*) AS n
     FROM financial_ledger_entries
     WHERE business_event_id IS NULL AND deleted_at IS NULL
     GROUP BY transaction_date, description
     ORDER BY transaction_date ASC
     LIMIT 30`
  );
  console.log('===== FINANCIAL ORPHANS BY DATE =====');
  for (const r of fByDate) {
    console.log(`  ${r.transaction_date} | ${r.description ?? '<sem desc>'} | ${r.n}`);
  }

  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
