const mysql = require('mysql2/promise');

async function test() {
  try {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: 'Dani160779!',
      database: 'co_ceo_db'
    });
    const [rows] = await conn.query('SHOW TABLES;');
    console.log(rows);
    conn.end();
  } catch (err) {
    console.error(err);
  }
}

test();
