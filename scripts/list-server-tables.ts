import 'dotenv/config';
import mysql from 'mysql2/promise';

(async () => {
  const password = process.env.REMOTE_DB_PASSWORD;
  if (!password) {
    console.error('Set REMOTE_DB_PASSWORD');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: 'root',
    password,
    database: 'co_ceo_platform',
  });

  const [tables] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'co_ceo_platform' ORDER BY table_name`
  );
  for (const t of tables) {
    const name = String(Object.values(t)[0]);
    const [c] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) c FROM \`${name}\``);
    console.log(`${name.padEnd(38)} ${String(c[0]!.c).padStart(7)}`);
  }

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
