/*
 * Diagnostica encoding do nome da organizacao no banco remoto.
 * Mostra o nome em utf8mb4, em hex e em latin1 pra ajudar a identificar
 * onde o mojibake foi introduzido.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const host = process.env.REMOTE_DB_HOST || '69.62.99.34';
  const conn = await mysql.createConnection({
    host,
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const [rows] = await conn.query(
    `SELECT id, name,
            HEX(name) AS name_hex,
            CONVERT(name USING latin1) AS name_as_latin1,
            LENGTH(name) AS bytes
     FROM organizations
     WHERE name LIKE '%Gon%alves%' OR name LIKE '%Holding%'`
  );
  console.log(JSON.stringify(rows, null, 2));

  const [charset] = await conn.query(`
    SELECT
      @@character_set_client AS client,
      @@character_set_connection AS connection,
      @@character_set_database AS database_cs,
      @@character_set_server AS server,
      @@collation_database AS collation_db
  `);
  console.log('Charset:', charset);

  const [cols] = await conn.query(`
    SELECT COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'organizations'
      AND COLUMN_NAME IN ('name', 'cnpj')
  `);
  console.log('organizations.name column charset:', cols);

  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
