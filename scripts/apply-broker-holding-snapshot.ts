/**
 * Aplica snapshot do homebroker BTG (ações, opções, caixa, RF, patrimônio total).
 *
 *   npm run apply:broker:snapshot
 *   npm run apply:broker:snapshot -- 2026-05-24
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { applyBrokerHoldingSnapshot } from '../src/core/invest/applyBrokerHoldingSnapshot';
import {
  BROKER_OPTION_MARKS,
  BROKER_PATRIMONY_COMPOSITION,
  BROKER_STOCK_MARKS,
  sumBrokerMarks,
} from '../src/core/invest/brokerHoldingSnapshot';
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

  console.log('=== Snapshot homebroker BTG ===\n');
  console.log('Composição alvo:');
  console.log('  RV:        ', BROKER_PATRIMONY_COMPOSITION.variableIncome.toLocaleString('pt-BR'));
  console.log('  RF:        ', BROKER_PATRIMONY_COMPOSITION.fixedIncome.toLocaleString('pt-BR'));
  console.log('  Caixa:     ', BROKER_PATRIMONY_COMPOSITION.cash.toLocaleString('pt-BR'));
  console.log('  Trânsito:  ', BROKER_PATRIMONY_COMPOSITION.inTransit.toLocaleString('pt-BR'));
  console.log('  Derivativos:', BROKER_PATRIMONY_COMPOSITION.derivatives.toLocaleString('pt-BR'));
  console.log('  Total:     ', BROKER_PATRIMONY_COMPOSITION.totalPatrimony.toLocaleString('pt-BR'));
  console.log(
    '  Soma marks (ações+opções):',
    (sumBrokerMarks(BROKER_STOCK_MARKS) + sumBrokerMarks(BROKER_OPTION_MARKS)).toLocaleString('pt-BR')
  );
  console.log('');

  const result = await applyBrokerHoldingSnapshot(gateway, ORG, dateArg);
  console.log('Data:', result.asOf);
  console.log('Posições atualizadas:', result.positionsTouched);
  console.log('Cotações gravadas:', result.quotesUpdated);
  console.log('Caixa atualizada:', result.cashAccountUpdated ? 'sim' : 'não');
  console.log('Âncora patrimônio:', result.anchorPatrimony.toLocaleString('pt-BR'));
  console.log(
    'Marks — ações:',
    result.impliedFromMarks.stocks.toLocaleString('pt-BR'),
    '| opções:',
    result.impliedFromMarks.options.toLocaleString('pt-BR')
  );
  if (result.positionsMissing.length) {
    console.log('Tickers não encontrados no livro:', result.positionsMissing.join(', '));
  }

  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const recorder = new PatrimonyDailyRecorder(gateway);
  console.log('\nGravando fechamento do dia…');
  const saved = await recorder.recordDay(ctx, result.asOf);
  console.log('  Patrimônio gravado:', saved.recorded.patrimony.toLocaleString('pt-BR'));
  console.log('  Econômico (auditoria):', saved.economicPatrimony.toLocaleString('pt-BR'));
  if (saved.btgPatrimony != null) {
    console.log('  BTG interpolado:', saved.btgPatrimony.toLocaleString('pt-BR'));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
