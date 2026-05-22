const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function importDb() {
  console.log('Connecting to database...');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'co_ceo_db',
    multipleStatements: true
  });

  try {
    console.log('Reading dump.sql...');
    const sql = fs.readFileSync('dump.sql', 'utf8');
    
    console.log('Executing SQL statements (this may take a moment)...');
    await connection.query(sql);
    console.log('Database imported successfully!');
  } catch (error) {
    console.error('Error importing database:', error);
  } finally {
    await connection.end();
  }
}

importDb();
