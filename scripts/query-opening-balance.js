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

  console.log('=== SALDO INICIAL — CARTEIRA (patrimony) ===');
  const [pat] = await conn.query(`
    SELECT pi.identifier, pi.subcategory, pi.name,
           ple.quantity_delta, ple.unit_value, ple.total_value,
           ple.transaction_date, ple.movement_type, ple.notes
    FROM patrimony_ledger_entries ple
    JOIN patrimony_items pi ON ple.patrimony_item_id = pi.id
    WHERE ple.movement_type = 'opening_balance'
       OR ple.notes LIKE '%saldo inicial%'
       OR ple.notes LIKE '%SALDO INICIAL%'
       OR ple.notes LIKE '%opening%'
    ORDER BY pi.subcategory, pi.identifier
  `);
  for (const r of pat) {
    console.log(
      (r.transaction_date ? String(r.transaction_date).slice(0, 10) : '—'),
      String(r.identifier || '').padEnd(14),
      String(r.subcategory || '').padEnd(12),
      'qty:', Number(r.quantity_delta).toFixed(4).padStart(12),
      'pu:', Number(r.unit_value).toFixed(4).padStart(10),
      'total:', Number(r.total_value).toFixed(2).padStart(14),
      r.notes ? '| ' + String(r.notes).slice(0, 60) : ''
    );
  }

  console.log('\n=== SALDO INICIAL — CAIXA (financial) ===');
  const [cash] = await conn.query(`
    SELECT fa.name, fa.account_type,
           fle.amount, fle.direction, fle.transaction_date, fle.description
    FROM financial_ledger_entries fle
    JOIN financial_accounts fa ON fle.account_id = fa.id
    WHERE fle.description LIKE '%saldo%'
       OR fle.description LIKE '%SALDO%'
       OR fle.description LIKE '%opening%'
       OR fle.external_ref LIKE '%OPENING%'
    ORDER BY fle.transaction_date
  `);
  for (const r of cash) {
    console.log(
      String(r.transaction_date).slice(0, 10),
      r.direction,
      Number(r.amount).toFixed(2).padStart(14),
      r.name,
      r.description ? '| ' + String(r.description).slice(0, 50) : ''
    );
  }
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
