/**
 * Converte linhas com movement_type short_open/short_close para
 * disposition/acquisition antes de remover esses valores do ENUM.
 *
 *   short_open  (venda de opcao, qty negativa) → disposition
 *   short_close (recompra de opcao, qty positiva) → acquisition
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  // Verificar quantas linhas existem
  const [counts] = await conn.query(
    "SELECT movement_type, COUNT(*) AS cnt FROM patrimony_ledger_entries WHERE movement_type IN ('short_open','short_close') GROUP BY movement_type"
  );
  console.log('Linhas a migrar:', counts);

  if (counts.length === 0) {
    console.log('Nada a fazer.');
    await conn.end();
    return;
  }

  // short_open → disposition
  const [r1] = await conn.query(
    "UPDATE patrimony_ledger_entries SET movement_type = 'disposition' WHERE movement_type = 'short_open'"
  );
  console.log(`short_open → disposition: ${r1.affectedRows} linhas`);

  // short_close → acquisition
  const [r2] = await conn.query(
    "UPDATE patrimony_ledger_entries SET movement_type = 'acquisition' WHERE movement_type = 'short_close'"
  );
  console.log(`short_close → acquisition: ${r2.affectedRows} linhas`);

  await conn.end();
  console.log('Concluido. Pode aplicar migration 19 agora.');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
