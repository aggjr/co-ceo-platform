/**
 * Remove fechamentos diários gravados (invest_portfolio_daily) da organização.
 * Use após purge do livro ou antes de reconstruir a série dia a dia.
 *
 * Uso: npx ts-node scripts/clear-patrimony-daily.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const [res] = await pool.query(
    'DELETE FROM invest_portfolio_daily WHERE organization_id = ?',
    [ORG]
  );
  const n = (res as { affectedRows: number }).affectedRows;
  console.log(`Removidos ${n} fechamento(s) diário(s) para ${ORG}.`);
  console.log('Após importar o livro: npx ts-node scripts/record-daily-patrimony.ts');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
