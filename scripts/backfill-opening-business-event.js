/*
 * Backfill: cria 1 business_event (kind='opening_balance') e vincula todas
 * as pernas patrimony_ledger + financial_ledger criadas em 01/01/2026 como
 * saldo inicial. Idempotente: se ja existir o header com source_ref
 * 'OPENING:<date>', reusa.
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   node scripts/backfill-opening-business-event.js [org-holding-001] [2026-01-01]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

const ORG = process.argv[2] || process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const OPENING_DATE = process.argv[3] || '2026-01-01';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: 'co_ceo_platform',
  });

  const sourceRef = `OPENING:${OPENING_DATE}`;
  const [existing] = await conn.query(
    `SELECT id FROM business_events
     WHERE organization_id=? AND source_module='INVEST'
       AND source_ref=? AND revision_no=1 AND deleted_at IS NULL`,
    [ORG, sourceRef]
  );

  let eventId;
  if (existing.length) {
    eventId = existing[0].id;
    console.log(`Header ja existia: ${eventId}`);
  } else {
    eventId = randomUUID();
    await conn.query(
      `INSERT INTO business_events
        (id, organization_id, source_module, event_kind, occurred_on, settles_on,
         source_ref, counterparty, total_gross, total_costs, total_net,
         source_system, source_version, revision_no)
       VALUES (?, ?, 'INVEST', 'opening_balance', ?, ?, ?, 'Saldo inicial',
               0, 0, 0, 'backfill_opening_2026', 'mig16', 1)`,
      [eventId, ORG, OPENING_DATE, OPENING_DATE, sourceRef]
    );
    console.log(`Header criado: ${eventId}`);
  }

  const [pUpd] = await conn.query(
    `UPDATE patrimony_ledger_entries
     SET business_event_id=?
     WHERE organization_id=? AND movement_type='opening_balance'
       AND transaction_date=? AND business_event_id IS NULL
       AND deleted_at IS NULL`,
    [eventId, ORG, OPENING_DATE]
  );
  console.log(`patrimony_ledger_entries vinculadas: ${pUpd.affectedRows}`);

  const [fUpd] = await conn.query(
    `UPDATE financial_ledger_entries
     SET business_event_id=?
     WHERE organization_id=? AND transaction_date=?
       AND description='Saldo inicial'
       AND business_event_id IS NULL
       AND deleted_at IS NULL`,
    [eventId, ORG, OPENING_DATE]
  );
  console.log(`financial_ledger_entries vinculadas: ${fUpd.affectedRows}`);

  // Verifica orfaos (pernas opening sem header)
  const [orphP] = await conn.query(
    `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
     WHERE organization_id=? AND movement_type='opening_balance'
       AND transaction_date=? AND business_event_id IS NULL AND deleted_at IS NULL`,
    [ORG, OPENING_DATE]
  );
  const [orphF] = await conn.query(
    `SELECT COUNT(*) AS n FROM financial_ledger_entries
     WHERE organization_id=? AND transaction_date=?
       AND description='Saldo inicial' AND business_event_id IS NULL
       AND deleted_at IS NULL`,
    [ORG, OPENING_DATE]
  );
  console.log(`Orfaos patrimony: ${orphP[0].n} | Orfaos financial: ${orphF[0].n}`);

  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
