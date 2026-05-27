const mysql = require('mysql2/promise');
async function test() {
  try {
    const conn = await mysql.createConnection({
      host: '127.0.0.1', user: 'root', password: 'Dani160779!', database: 'co_ceo_db'
    });
    await conn.query('ALTER TABLE ui_components MODIFY COLUMN kind VARCHAR(50) NOT NULL');
    console.log('Altered table successfully');
    conn.end();
  } catch(e) { console.error(e); }
}
test();
