import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

async function main() {
  const dir = 'src/database/migrations';
  const files = fs.readdirSync(dir).filter(f => f.match(/^[1-3][7-9]_.+\.sql$/) || f.match(/^[2-3][0-9]_.+\.sql$/)).sort();
  
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db',
    multipleStatements: true
  });
  
  for (const f of files) {
    console.log('Running:', f);
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      await conn.query(sql);
      console.log(' OK');
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_TABLE_EXISTS_ERROR' || e.code === 'ER_DUP_KEYNAME') {
        console.log(' Already applied (ignored)');
      } else {
        console.error(' Failed:', e.message);
      }
    }
  }
  
  await conn.end();
}
main().catch(console.error);
