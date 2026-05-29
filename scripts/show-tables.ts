import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({host:'localhost',user:'root',password:'Dani160779!',database:'co_ceo_db'});
  const [rows] = await pool.query('SHOW TABLES');
  console.log(rows);
  process.exit(0);
}
main();
