/*
 * Mostra o header opening + todas as pernas vinculadas.
 * Uso:
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   node scripts/inspect-opening.js
 */
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
    `SELECT id, source_ref, event_kind, occurred_on, total_net, source_system
     FROM business_events
     WHERE source_ref = 'OPENING:2026-01-01' AND deleted_at IS NULL`
  );
  console.log('===== HEADER OPENING =====');
  console.log(JSON.stringify(headers, null, 2));

  if (!headers.length) {
    await conn.end();
    process.exit(0);
  }
  const eventId = headers[0].id;

  const [patrimony] = await conn.query(
    `SELECT e.id AS leg_id, i.identifier AS ticker, i.subcategory, i.status,
            e.movement_type, e.quantity_delta, e.unit_value, e.total_value,
            e.external_ref, e.notes
     FROM patrimony_ledger_entries e
     JOIN patrimony_items i ON i.id = e.patrimony_item_id
     WHERE e.business_event_id = ? AND e.deleted_at IS NULL
     ORDER BY i.identifier`,
    [eventId]
  );
  console.log(`\n===== PATRIMONY LEGS DO OPENING (${patrimony.length}) =====`);
  for (const p of patrimony) {
    console.log(
      `  ${String(p.ticker).padEnd(20)} ${String(p.subcategory).padEnd(14)} ${String(p.movement_type).padEnd(18)} qty=${p.quantity_delta} pu=${p.unit_value} total=${p.total_value} status=${p.status}`
    );
  }

  const [financial] = await conn.query(
    `SELECT e.id, a.name AS account, a.external_id,
            e.transaction_date, e.direction, e.amount, e.status, e.description
     FROM financial_ledger_entries e
     JOIN financial_accounts a ON a.id = e.account_id
     WHERE e.business_event_id = ? AND e.deleted_at IS NULL`,
    [eventId]
  );
  console.log(`\n===== FINANCIAL LEGS DO OPENING (${financial.length}) =====`);
  for (const f of financial) {
    console.log(
      `  ${String(f.account).padEnd(24)} ext=${f.external_id} ${f.direction} ${f.amount} status=${f.status} | ${f.description}`
    );
  }

  const [items] = await conn.query(
    `SELECT identifier, subcategory, quantity, acquisition_value, current_value, status
     FROM patrimony_items
     WHERE organization_id = 'org-holding-001' AND deleted_at IS NULL
     ORDER BY identifier`
  );
  console.log(`\n===== PATRIMONY_ITEMS (snapshot atual) =====`);
  let totalLong = 0;
  let totalShort = 0;
  for (const it of items) {
    const v = Number(it.acquisition_value) || 0;
    if (Number(it.quantity) < 0) totalShort += v;
    else totalLong += v;
    console.log(
      `  ${String(it.identifier).padEnd(20)} ${String(it.subcategory).padEnd(14)} qty=${it.quantity}  acq=${it.acquisition_value}  curr=${it.current_value}  status=${it.status}`
    );
  }
  console.log(`\nTotal long  (acq):  R$ ${totalLong.toFixed(2)}`);
  console.log(`Total short (acq):  R$ ${totalShort.toFixed(2)}`);
  console.log(`Net (long - short): R$ ${(totalLong - totalShort).toFixed(2)}`);

  const [accounts] = await conn.query(
    `SELECT name, external_id, opening_balance, status
     FROM financial_accounts
     WHERE organization_id = 'org-holding-001' AND deleted_at IS NULL`
  );
  console.log(`\n===== FINANCIAL_ACCOUNTS =====`);
  for (const a of accounts) {
    console.log(
      `  ${String(a.name).padEnd(28)} ext=${a.external_id} opening=${a.opening_balance} status=${a.status}`
    );
  }

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
