/*
 * Aplica arquivo SQL no banco remoto (co_ceo_platform).
 *
 * Uso (PowerShell):
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   node scripts/apply-migration-remote.js src/database/migrations/16_business_events.sql
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/apply-migration-remote.js <arquivo.sql>');
  process.exit(1);
}
if (!process.env.REMOTE_DB_PASSWORD) {
  console.error('Defina REMOTE_DB_PASSWORD no ambiente antes de rodar.');
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const host = process.env.REMOTE_DB_HOST || '69.62.99.34';
  const conn = await mysql.createConnection({
    host,
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  console.log(`Aplicando ${file} em ${host}/co_ceo_platform ...`);
  await conn.query(sql);
  console.log(`OK: ${file}`);
  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
