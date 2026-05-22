/*
 * Lista todas as pernas patrimony/financial e verifica se cada uma tem
 * business_event_id setado, agrupando por header.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const [headers] = await conn.query(
    `SELECT id, source_ref, event_kind, occurred_on, total_net, source_system
       FROM business_events
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY occurred_on, source_ref`,
    [ORG_ID]
  );
  console.log(`\n===== HEADERS (${headers.length}) =====`);
  for (const h of headers) {
    console.log(`  ${h.id.slice(0, 8)}.. ${h.event_kind.padEnd(20)} ${(h.source_ref || '(null)').padEnd(40)} total_net=${h.total_net} (${h.source_system})`);
  }

  console.log(`\n===== PATRIMONY LEDGER ENTRIES =====`);
  const [patrimony] = await conn.query(
    `SELECT e.id, e.business_event_id, e.transaction_date, e.movement_type,
            i.identifier, e.quantity_delta, e.unit_value, e.total_value, e.external_ref
       FROM patrimony_ledger_entries e
       JOIN patrimony_items i ON i.id = e.patrimony_item_id
      WHERE e.organization_id = ? AND e.deleted_at IS NULL
      ORDER BY e.transaction_date, i.identifier`,
    [ORG_ID]
  );
  let orphanP = 0;
  for (const p of patrimony) {
    const evt = p.business_event_id ? p.business_event_id.slice(0, 8) + '..' : '   ORPHAN   ';
    if (!p.business_event_id) orphanP += 1;
    console.log(`  ${evt}  ${p.transaction_date.toISOString().slice(0, 10)}  ${String(p.identifier).padEnd(20)} ${String(p.movement_type).padEnd(18)} qty=${p.quantity_delta} pu=${p.unit_value} ext_ref=${p.external_ref || ''}`);
  }
  console.log(`  TOTAL: ${patrimony.length} (orphan: ${orphanP})`);

  console.log(`\n===== FINANCIAL LEDGER ENTRIES =====`);
  const [financial] = await conn.query(
    `SELECT e.id, e.business_event_id, e.transaction_date, e.direction, e.amount,
            a.name AS account, a.external_id, e.description, e.external_ref
       FROM financial_ledger_entries e
       JOIN financial_accounts a ON a.id = e.account_id
      WHERE e.organization_id = ? AND e.deleted_at IS NULL
      ORDER BY e.transaction_date`,
    [ORG_ID]
  );
  let orphanF = 0;
  for (const f of financial) {
    const evt = f.business_event_id ? f.business_event_id.slice(0, 8) + '..' : '   ORPHAN   ';
    if (!f.business_event_id) orphanF += 1;
    console.log(`  ${evt}  ${f.transaction_date.toISOString().slice(0, 10)}  ${String(f.account).padEnd(24)} ${f.direction} ${f.amount} ext_ref=${f.external_ref || ''} | ${f.description}`);
  }
  console.log(`  TOTAL: ${financial.length} (orphan: ${orphanF})`);

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
