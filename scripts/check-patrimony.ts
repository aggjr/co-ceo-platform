import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({host:'localhost',user:'root',password:'Dani160779!',database:'co_ceo_db'});
  const [rows] = await pool.query('SELECT * FROM patrimony_items LIMIT 5');
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main();
