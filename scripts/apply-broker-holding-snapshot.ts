/**
 * Aplica snapshot do homebroker BTG já importado no banco.
 *
 *   npm run import:broker:snapshot -- local-import/btg-sources/custody-snapshot.json
 *   npm run apply:broker:snapshot
 *   npm run apply:broker:snapshot -- 2026-05-23
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { applyBrokerHoldingSnapshot } from '../src/core/invest/applyBrokerHoldingSnapshot';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';
import { installerContext } from '../src/database/seeds/lib/installerContext';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);

  console.log('=== Aplicar snapshot homebroker (banco) ===\n');

  const result = await applyBrokerHoldingSnapshot(gateway, ORG, dateArg);
  console.log('Snapshot id:   ', result.snapshotId);
  console.log('Data:          ', result.asOf);
  console.log('Posições:      ', result.positionsTouched);
  console.log('Cotações:      ', result.quotesUpdated);
  console.log('Caixa:         ', result.cashAccountUpdated ? 'sim' : 'não');
  console.log('Âncora:        ', result.anchorPatrimony.toLocaleString('pt-BR'));
  console.log(
    'Marks ações:   ',
    result.impliedFromMarks.stocks.toLocaleString('pt-BR'),
    '| opções:',
    result.impliedFromMarks.options.toLocaleString('pt-BR')
  );
  if (result.positionsMissing.length) {
    console.log('Faltantes:     ', result.positionsMissing.join(', '));
  }

  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const recorder = new PatrimonyDailyRecorder(gateway);
  console.log('\nGravando fechamento do dia…');
  const saved = await recorder.recordDay(ctx, result.asOf);
  console.log('  Patrimônio gravado:', saved.recorded.patrimony.toLocaleString('pt-BR'));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
