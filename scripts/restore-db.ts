import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    multipleStatements: true,
  });

  const sqlPath = path.join(__dirname, '../database/dumps/co_ceo_db_full_export.sql');
  console.log(`Reading ${sqlPath}`);
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  console.log('Executing DB dump...');
  await pool.query(sql);
  
  console.log('Database restored successfully!');
  await pool.end();
}

main().catch(console.error);
