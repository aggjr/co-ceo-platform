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

  // Opcoes com PRIO no identifier
  const [opts] = await conn.query(`
    SELECT pi.id, pi.identifier, pi.subcategory, pi.quantity, pi.acquisition_value,
           ioe.option_type, ioe.underlying_ticker, ioe.strike_price, ioe.expiration_date
    FROM patrimony_items pi
    LEFT JOIN invest_option_ext ioe ON ioe.patrimony_item_id = pi.id
    WHERE pi.identifier LIKE 'PRIO%'
      AND pi.deleted_at IS NULL
  `);
  console.log('=== OPTIONS PRIO% ===');
  for (const r of opts) {
    console.log(r.identifier.padEnd(12), 'sub:', r.subcategory.padEnd(12),
      'opt_type:', (r.option_type||'NULL').padEnd(6),
      'underlying:', (r.underlying_ticker||'NULL').padEnd(8),
      'strike:', r.strike_price, 'exp:', r.expiration_date,
      'qty:', Number(r.quantity).toFixed(0));
  }

  // Ledger dos PRIO options - entries
  const [les] = await conn.query(`
    SELECT pi.identifier, ple.movement_type, ple.quantity_delta, ple.unit_value,
           ple.transaction_date
    FROM patrimony_ledger_entries ple
    JOIN patrimony_items pi ON ple.patrimony_item_id = pi.id
    WHERE pi.identifier LIKE 'PRIO%'
      AND pi.identifier != 'PRIO3'
    ORDER BY pi.identifier, ple.transaction_date
  `);
  console.log('\n=== LEDGER PRIO OPTIONS ===');
  for (const r of les) {
    console.log(r.transaction_date.toISOString().slice(0,10),
      r.identifier.padEnd(12), r.movement_type.padEnd(12),
      'qty:', Number(r.quantity_delta).toFixed(0).padStart(7),
      'pu:', Number(r.unit_value).toFixed(4));
  }
  await conn.end();
}
main().catch(console.error);
