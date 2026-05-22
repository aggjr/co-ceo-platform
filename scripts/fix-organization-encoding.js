/*
 * Corrige encoding do nome das organizacoes no banco (idempotente).
 *
 * Forca a conexao em utf8mb4 e re-grava o nome correto para os ids canonicos.
 * Tambem normaliza qualquer outro `organizations.name` que pareca ter
 * mojibake (chars como 'Ã§', 'â€', 'Ã£', 'Ã©' juntos sugerem dupla codificacao).
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   node scripts/fix-organization-encoding.js
 *
 * (local: ajusta DB_HOST/DB_USER no .env padrao)
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const CANONICAL = [
  { id: 'org-holding-001', name: 'Holding Financeira Gonçalves' },
];

const MOJIBAKE_SIGNATURES = [
  'Gon³alves',
  'Gonalves', // espaco non-printable entre n e c
  'GonÃ§alves',
  'GonÃ¢',
  'â€¦',
];

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const user = process.env.REMOTE_DB_USER || process.env.DB_USER || 'root';
  const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD || '';
  const database = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';

  console.log(`Conectando em ${user}@${host}/${database} com charset=utf8mb4`);
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    charset: 'utf8mb4',
  });

  // Garante que a sessao toda interprete bytes como utf8mb4.
  await conn.query("SET NAMES 'utf8mb4'");

  console.log('\nDiagnostico ANTES do fix:');
  const [before] = await conn.query(
    `SELECT id, name, HEX(name) AS hex, LENGTH(name) AS bytes
     FROM organizations
     ORDER BY name`
  );
  for (const row of before) {
    console.log(`  [${row.id}] '${row.name}' bytes=${row.bytes} hex=${row.hex}`);
  }

  let totalFixed = 0;

  // 1) UPDATE para IDs canonicos conhecidos.
  for (const c of CANONICAL) {
    const [res] = await conn.query(
      `UPDATE organizations SET name = ? WHERE id = ? AND name <> ?`,
      [c.name, c.id, c.name]
    );
    if (res.affectedRows > 0) {
      console.log(`  fixado canonico: ${c.id} -> '${c.name}'`);
      totalFixed += res.affectedRows;
    }
  }

  // 2) Heuristica para outros names com mojibake conhecido (sem id mapeado).
  for (const sig of MOJIBAKE_SIGNATURES) {
    const [matches] = await conn.query(
      `SELECT id, name FROM organizations WHERE name LIKE ?`,
      [`%${sig}%`]
    );
    for (const row of matches) {
      console.log(`  alerta mojibake [${row.id}] '${row.name}' (assinatura '${sig}')`);
    }
  }

  console.log(`\nLinhas corrigidas: ${totalFixed}`);

  console.log('\nDiagnostico DEPOIS do fix:');
  const [after] = await conn.query(
    `SELECT id, name, HEX(name) AS hex, LENGTH(name) AS bytes
     FROM organizations
     ORDER BY name`
  );
  for (const row of after) {
    console.log(`  [${row.id}] '${row.name}' bytes=${row.bytes} hex=${row.hex}`);
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
