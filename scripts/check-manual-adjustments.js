require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  console.log('--- Buscando lançamentos com referências de correção ou ajuste ---');
  const [rows] = await c.query(
    `SELECT e.id, a.asset_ticker, e.transaction_date, e.transaction_type, e.quantity, e.unit_price, e.broker_note_ref, e.notes
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.deleted_at IS NULL
       AND (
         e.broker_note_ref LIKE 'CORR-%'
         OR e.notes LIKE '%ajuste%'
         OR e.notes LIKE '%correção%'
         OR e.notes LIKE '%corrigido%'
         OR e.notes LIKE '%marreta%'
         OR e.notes LIKE '%manual%'
       )
     ORDER BY e.transaction_date`
  );

  if (rows.length === 0) {
    console.log('Nenhum lançamento manual ou corretivo explícito encontrado no banco.');
  } else {
    console.log(`Encontrados ${rows.length} lançamentos suspeitos de ajuste manual:`);
    console.table(rows);
  }

  await c.end();
})().catch(console.error);
