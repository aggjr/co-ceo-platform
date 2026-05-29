import mysql from 'mysql2/promise';

async function main() {
  try {
    const pool = mysql.createPool({
      host: '69.62.99.34',
      user: 'root',
      password: 'Dani160779!',
      database: 'co_ceo_db'
    });
    await pool.query('SELECT 1');
    console.log('Connected to REMOTE db!');
    await pool.end();
  } catch (e: any) {
    console.error('Remote connection error:', e.message);
  }
}

main();
