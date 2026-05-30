const mysql = require('mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db',
  });
  const [rows] = await pool.query('SHOW TABLES');
  rows.forEach(r => console.log(Object.values(r)[0]));
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
