/**
 * Lança no livro razão as opções da custódia BTG ainda sem nota de corretagem.
 *
 *   npm run apply:broker:options-ledger
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  BROKER_SNAPSHOT_PENDING_DATE,
  BROKER_SNAPSHOT_PENDING_EVENT_REF,
  buildBrokerOptionsPendingLedgerLines,
} from '../src/core/invest/brokerOptionsPendingLedger';
import { applyBrokerHoldingSnapshot } from '../src/core/invest/applyBrokerHoldingSnapshot';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';
import { InvestAssetProjection } from '../src/modules/invest/sync/InvestAssetProjection';
import { inferAssetType } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const projection = new InvestAssetProjection(gateway);

  const entries = buildBrokerOptionsPendingLedgerLines();
  console.log('=== Lançamentos provisórios (custódia BTG) ===\n');
  console.log('Data:', BROKER_SNAPSHOT_PENDING_DATE);
  console.log('Header:', BROKER_SNAPSHOT_PENDING_EVENT_REF);
  console.log('Linhas:', entries.length);
  for (const e of entries) {
    console.log(
      `  ${e.ticker.padEnd(12)} ${String(e.operation).padEnd(10)} qty=${String(e.quantity).padStart(6)} @ ${e.unit_price}`
    );
  }
  console.log('');

  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'Snapshot BTG — aguardando notas',
  });
  console.log('Import:', result);

  const assets = await projection.listActiveAssets(ctx);
  const brokerTickers = new Set(
    [
      'ITUBF422', 'ITUBF427', 'ITUBF432', 'ITUBF437', 'ITUBF445',
      'PRIOF740', 'PRIOF755', 'PRIOF760', 'PRIOF770', 'PRIOF775', 'PRIOF785', 'PRIOF800', 'PRIOF820',
      'WEGER441',
    ]
  );
  console.log('\n--- Custódia após import (amostra) ---');
  for (const a of assets) {
    const t = String(a.asset_ticker).toUpperCase();
    if (!brokerTickers.has(t)) continue;
    const type = inferAssetType(t);
    if (type !== 'option_call' && type !== 'option_put') continue;
    console.log(`  ${t} qty=${a.current_quantity} value=${a.current_value}`);
  }

  console.log('\n--- Marcas de mercado (snapshot) ---');
  const snap = await applyBrokerHoldingSnapshot(gateway, ORG, BROKER_SNAPSHOT_PENDING_DATE);
  console.log('Posições tocadas:', snap.positionsTouched, '| faltantes:', snap.positionsMissing.join(', ') || '(nenhum)');

  const recorder = new PatrimonyDailyRecorder(gateway);
  const saved = await recorder.recordDay(ctx, BROKER_SNAPSHOT_PENDING_DATE);
  console.log('\nPatrimônio gravado:', saved.recorded.patrimony.toLocaleString('pt-BR'));
  console.log('Econômico (auditoria):', saved.economicPatrimony.toLocaleString('pt-BR'));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
