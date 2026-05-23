/**
 * Backfills invest_portfolio_daily for all days from a start date to yesterday.
 * Used to lock the daily patrimony curve on the "Resultado Histórico" page.
 *
 * Usage:
 *   node ./node_modules/ts-node/dist/bin.js scripts/backfill-daily-patrimony.ts [YYYY-MM-DD]
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const START_DATE = process.argv[2] || '2026-01-01';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const recorder = new PatrimonyDailyRecorder(gateway);

  const start = new Date(START_DATE);
  // Iterate up to yesterday
  const end = new Date();
  end.setDate(end.getDate() - 1); 

  console.log(`Iniciando backfill diário de patrimônio de ${start.toISOString().slice(0,10)} até ${end.toISOString().slice(0,10)}...`);

  const current = new Date(start);
  while (current <= end) {
    const targetDate = current.toISOString().slice(0, 10);
    try {
      const result = await recorder.recordDay(ctx, targetDate);
      console.log(`[${targetDate}] Gravado: ${result.recorded.patrimony.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} (TWR Acumulado: ${result.recorded.cumulative_twr != null ? (result.recorded.cumulative_twr * 100).toFixed(4) + '%' : '—'})`);
    } catch (e: any) {
      console.warn(`[${targetDate}] Aviso: ${e.message}`);
    }
    current.setDate(current.getDate() + 1);
  }

  console.log('Backfill concluído com sucesso!');
  await pool.end();
}

main().catch((e) => {
  console.error('Erro no backfill:', e);
  process.exit(1);
});
