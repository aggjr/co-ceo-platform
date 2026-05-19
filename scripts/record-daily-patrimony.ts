/**
 * Grava fechamento diário econômico (patrimônio + posições) no MySQL.
 * Agendar 1x/dia após atualizar cotações (ex.: após sync-necton-patrimony).
 *
 * Uso:
 *   node ./node_modules/ts-node/dist/bin.js scripts/record-daily-patrimony.ts
 *   node ./node_modules/ts-node/dist/bin.js scripts/record-daily-patrimony.ts 2026-05-19
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const dateArg = process.argv[2]?.slice(0, 10);

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

  const result = await recorder.recordDay(ctx, dateArg);
  console.log('Gravado:', result.snapshotDate);
  console.log('Patrimônio:', result.recorded.patrimony.toLocaleString('pt-BR'));
  console.log('TWR dia:', result.recorded.daily_return_twr != null ? `${(result.recorded.daily_return_twr * 100).toFixed(4)}%` : '—');
  console.log('TWR acum. (série gravada):', result.recorded.cumulative_twr != null ? `${(result.recorded.cumulative_twr * 100).toFixed(4)}%` : '—');
  console.log('Posições snapshot:', result.positionsSaved);
  console.log('Cotações as_of:', result.quotesAsOf ?? '(metadata dos ativos)');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
