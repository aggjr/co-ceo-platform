require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/run-migration.js <arquivo.sql>');
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    multipleStatements: true,
  });
  await conn.query(sql);
  console.log(`OK: ${file}`);
  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
