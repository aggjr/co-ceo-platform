/**
 * Importa exercícios BTG (ticker …E) de 15/05/2026 e recalcula custódia.
 * Antes: node scripts/purge-snapshot-sync.js (remove ajustes fictícios de qty).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { mapBrokerOrderToLedger } from '../src/core/invest/brokerOrderMapper';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';
import { buildThreeAvgPricesByUnderlying } from '../src/core/invest/portfolioThreePrices';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const BATCH_PREFIX = 'BTG-EXERCISE-2026-05-15';

type ExerciseFile = {
  exercise_date: string;
  orders: Array<{
    ticker: string;
    direction: 'C' | 'V';
    quantity: number;
    avgPrice: number;
    /** Se omitido, usa `exercise_date`. */
    date?: string;
  }>;
};

async function main() {
  const dataPath = path.join(
    __dirname,
    '..',
    'data',
    'invest',
    'btg-exercises-2026-05-15.json'
  );
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as ExerciseFile;
  const date = data.exercise_date;

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  // Ajuste B3 do prêmio da PUT no exercício é responsabilidade da engine de 3 preços
  // (livro razão guarda apenas a operação bruta — compra/venda no papel ao strike).
  const entries: LedgerImportLine[] = [];
  let seq = 0;
  for (const o of data.orders) {
    seq += 1;
    const orderDate = o.date || date;
    const mapped = mapBrokerOrderToLedger({
      ticker: o.ticker,
      direction: o.direction,
      quantity: o.quantity,
      avgPrice: o.avgPrice,
      date: orderDate,
      broker_note_ref: `${BATCH_PREFIX}#${seq}#${o.ticker}`,
    });
    entries.push(...mapped);
  }

  console.log(`Exercícios → ${entries.length} lançamentos (${data.orders.length} ordens)`);

  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'BTG exercícios 15/05/2026',
  });
  console.log('Import:', JSON.stringify(result, null, 2));

  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const three = buildThreeAvgPricesByUnderlying(events);
  for (const t of ['BBAS3', 'ITUB4', 'WEGE3', 'PRIO3']) {
    console.log(`PM ${t}:`, three.get(t));
  }

  const [assets] = await pool.query(
    `SELECT asset_ticker, current_quantity, managerial_avg_price
     FROM invest_assets WHERE organization_id = ? AND asset_ticker IN ('BBAS3','ITUB4','WEGE3','PRIO3')
     ORDER BY asset_ticker`,
    [ORG_ID]
  );
  console.log('Custódia:', JSON.stringify(assets, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
