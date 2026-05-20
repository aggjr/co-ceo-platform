import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  console.log(`Limpando todos os lançamentos do livro-razão para a organização: ${ORG}...`);

  const [res] = await pool.query(
    'DELETE FROM invest_ledger_entries WHERE organization_id = ?',
    [ORG]
  );

  console.log(`Sucesso: ${(res as any).affectedRows} lançamentos excluídos.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Erro ao limpar o livro-razão:', err);
  process.exit(1);
});
