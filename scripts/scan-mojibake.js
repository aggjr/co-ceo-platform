/*
 * Varre tabelas com colunas user-facing procurando mojibake.
 *
 * Detecta padroes conhecidos:
 *   - sequencias unicode classicas de double-encoding (├, Ã§, â€, etc)
 *   - bytes box-drawing (E2 94 9C, etc) em colunas de texto
 *
 * Apenas leitura — relata, nao altera.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// Padroes que indicam mojibake REAL (nao casam com texto comum em PT-BR).
// Atencao: usar COLLATE utf8mb4_bin para que A != Â (utf8mb4_unicode_ci
// trata como iguais e gera falsos positivos).
const SUSPECT_LIKE = [
  '%├%',
  '%┐%',
  '%┤%',
  '%┴%',
  '%Ã§%',
  '%Ã£%',
  '%Ãª%',
  '%Ã©%',
  '%Ã¡%',
  '%Ã³%',
  '%Ã­%',
  '%â€%',
  '%??%', // double "?" eh sinal classico de perda de info
];

const TARGETS = [
  { table: 'organizations', columns: ['name'] },
  { table: 'users', columns: ['full_name', 'preferred_name'] },
  { table: 'modules', columns: ['name', 'description'] },
  { table: 'roles', columns: ['name', 'description'] },
  { table: 'permissions', columns: ['description'] },
];

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const user = process.env.REMOTE_DB_USER || process.env.DB_USER || 'root';
  const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD || '';
  const database = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';

  console.log(`Varrendo ${user}@${host}/${database} em utf8mb4`);
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    charset: 'utf8mb4',
  });
  await conn.query("SET NAMES 'utf8mb4'");

  let total = 0;
  for (const t of TARGETS) {
    for (const col of t.columns) {
      // utf8mb4_bin para fazer comparacao byte-a-byte: A != Â.
      const where = SUSPECT_LIKE.map(
        () => `\`${col}\` COLLATE utf8mb4_bin LIKE ?`
      ).join(' OR ');
      const [rows] = await conn.query(
        `SELECT id, \`${col}\` AS value, HEX(\`${col}\`) AS hex
         FROM \`${t.table}\` WHERE ${where}`,
        SUSPECT_LIKE
      );
      if (rows.length > 0) {
        console.log(`\n[${t.table}.${col}] — ${rows.length} suspeito(s):`);
        for (const r of rows) {
          console.log(`  id=${r.id}`);
          console.log(`     value='${r.value}'`);
          console.log(`     hex=${r.hex}`);
        }
        total += rows.length;
      }
    }
  }

  if (total === 0) {
    console.log('\nOK — nenhum mojibake detectado nas colunas varridas.');
  } else {
    console.log(`\nTotal suspeito: ${total}`);
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
