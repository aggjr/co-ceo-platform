import fs from 'fs';
import mysql from 'mysql2/promise';

async function main() {
  const file = process.argv[2];
  const sql = fs.readFileSync(file, 'utf8');
  
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db',
    multipleStatements: true
  });
  
  await conn.query(sql);
  console.log('Executed:', file);
  await conn.end();
}
main().catch(console.error);
