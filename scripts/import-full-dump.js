/**
 * Importa database/dumps/co_ceo_db_full_export.sql no MySQL alvo.
 * Substitui o schema legado `co_ceo_db` por DB_NAME (.env), padrão co_ceo_platform.
 *
 * Uso:
 *   node scripts/import-full-dump.js
 *   node scripts/import-full-dump.js database/dumps/co_ceo_db_full_export.sql
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const SOURCE_DB = 'co_ceo_db';
const targetDb = (process.env.DB_NAME || 'co_ceo_platform').trim();
const sqlFile =
  process.argv[2] ||
  path.join(__dirname, '..', 'database', 'dumps', 'co_ceo_db_full_export.sql');

async function main() {
  if (!fs.existsSync(sqlFile)) {
    console.error(`Arquivo não encontrado: ${sqlFile}`);
    process.exit(1);
  }

  let sql = fs.readFileSync(sqlFile, 'utf8');
  if (sql.charCodeAt(0) === 0xfeff) sql = sql.slice(1);
  if (targetDb !== SOURCE_DB) {
    sql = sql.split(SOURCE_DB).join(targetDb);
    console.log(`Schema no dump: ${SOURCE_DB} → ${targetDb}`);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log(`Importando ${sqlFile} em ${process.env.DB_HOST || '127.0.0.1'}...`);
  await conn.query(sql);
  await conn.end();
  console.log(`Importação concluída. Database: ${targetDb}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
