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

  // Descobre colunas de patrimony_items
  const [cols] = await conn.query("DESCRIBE patrimony_items");
  console.log('patrimony_items cols:', cols.map(c => c.Field).join(', '));
  const [cols2] = await conn.query("DESCRIBE invest_option_ext");
  console.log('invest_option_ext cols:', cols2.map(c => c.Field).join(', '));
  await conn.end();
}
main().catch(console.error);
