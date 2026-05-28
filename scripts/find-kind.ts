import mysql from 'mysql2/promise';
async function main() {
  const pool = mysql.createPool({host:'localhost',user:'root',password:'Dani160779!',database:'co_ceo_db'});
  const [rows] = await pool.query('SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE COLUMN_NAME = "kind" AND TABLE_SCHEMA = "co_ceo_db"');
  console.log(rows);
  await pool.end();
}
main();
