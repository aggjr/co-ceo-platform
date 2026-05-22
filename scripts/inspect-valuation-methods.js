require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const [r] = await conn.query(
    `SELECT module_code, category, subcategory, default_valuation_method
       FROM module_categories
      WHERE module_code = 'invest'
      ORDER BY subcategory`
  );
  for (const x of r) console.log(x);

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
