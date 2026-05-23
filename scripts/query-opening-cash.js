require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina REMOTE_DB_PASSWORD ou DB_PASSWORD no ambiente.');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password,
    database: process.env.DB_NAME || process.env.REMOTE_DB_NAME || 'co_ceo_db',
    charset: 'utf8mb4',
  });
  const [cols] = await conn.query('DESCRIBE financial_ledger_entries');
  console.log('financial_ledger_entries:', cols.map(c => c.Field).join(', '));

  const [fin] = await conn.query(`
    SELECT fa.external_id, fa.name,
           fle.amount, fle.direction, fle.transaction_date, fle.metadata
    FROM financial_ledger_entries fle
    JOIN financial_accounts fa ON fle.account_id = fa.id
    WHERE JSON_UNQUOTE(JSON_EXTRACT(fle.metadata, '$.legacy_op')) = 'opening_balance'
       OR JSON_UNQUOTE(JSON_EXTRACT(fle.metadata, '$.description')) LIKE '%saldo inicial%'
       OR JSON_UNQUOTE(JSON_EXTRACT(fle.metadata, '$.description')) LIKE '%SALDO INICIAL%'
    ORDER BY fle.transaction_date, fa.external_id
  `);
  console.log('\n=== SALDO INICIAL — CAIXA ===');
  for (const r of fin) {
    const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
    console.log(
      String(r.transaction_date).slice(0,10),
      String(r.external_id||'').padEnd(12),
      String(r.name||'').slice(0,35).padEnd(35),
      r.direction.padEnd(3),
      Number(r.amount).toFixed(2).padStart(14),
      meta?.description ? '| ' + String(meta.description).slice(0,80) : ''
    );
  }
  console.log('Total:', fin.length);

  // fallback: first cash entries on 2026-01-01
  if (fin.length === 0) {
    const [fb] = await conn.query(`
      SELECT fa.external_id, fa.name, fle.amount, fle.direction, fle.transaction_date, fle.metadata
      FROM financial_ledger_entries fle
      JOIN financial_accounts fa ON fle.account_id = fa.id
      WHERE fle.transaction_date = '2026-01-01'
      ORDER BY fa.external_id
    `);
    console.log('\n=== Fallback: lançamentos caixa em 2026-01-01 ===');
    for (const r of fb) {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});
      console.log(r.external_id, r.direction, Number(r.amount).toFixed(2), JSON.stringify(meta).slice(0,120));
    }
  }
  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
