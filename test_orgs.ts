import mysql from 'mysql2/promise';

async function test() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db',
  });

  const connection = await pool.getConnection();
  const [rows] = await connection.query('SELECT u.email, ur.organization_id FROM users u JOIN user_roles ur ON u.id = ur.user_id');
  console.log(rows);
  connection.release();
  await pool.end();
}

test().then(() => process.exit(0)).catch(console.error);
