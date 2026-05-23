import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST,
    user: 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: 'co_ceo_platform',
  });
  const org = 'org-holding-001';
  for (const d of ['2026-04-27', '2026-04-28', '2026-04-29']) {
    const [r] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT transaction_date, direction, amount, description, external_ref
       FROM financial_ledger_entries
       WHERE organization_id = ? AND deleted_at IS NULL
         AND transaction_date BETWEEN DATE_SUB(?, INTERVAL 2 DAY) AND DATE_ADD(?, INTERVAL 2 DAY)
         AND (
           description LIKE '%BOLSA%' OR description LIKE '%LIQ%'
           OR external_ref LIKE 'BROKER_REF:BTG-NOTA-315%'
           OR external_ref LIKE 'BROKER_REF:BTG-NOTA-316%'
         )
       ORDER BY transaction_date, amount`,
      [org, d, d]
    );
    console.log(`--- janela ${d} --- ${r.length} linhas`);
    for (const x of r) {
      console.log(
        String(x.transaction_date).slice(0, 10),
        x.direction,
        Number(x.amount).toFixed(2),
        String(x.description || '').slice(0, 55),
        x.external_ref || ''
      );
    }
  }
  await pool.end();
}

main();
