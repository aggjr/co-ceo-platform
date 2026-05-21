/**
 * Importa saldos de abertura 01/01/2026 (ex.: DIRPF 31/12/2025) sem duplicar extratos.
 * Uso: npx ts-node scripts/import-opening-augusto.ts
 *      npx ts-node scripts/import-opening-augusto.ts data/invest/opening-ir-2026-01-01.json
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { OpeningImportPayload } from '../src/core/invest/ledgerTypes';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const DEFAULT_OPENING = path.join(
  __dirname,
  '..',
  'data',
  'invest',
  'opening-ir-2026-01-01.json'
);

async function main() {
  const file = path.resolve(process.argv[2] || DEFAULT_OPENING);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as OpeningImportPayload;

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  if (!fs.existsSync(file)) {
    console.error('Arquivo de abertura não encontrado:', file);
    process.exit(1);
  }

  console.log(`Abertura → org ${ORG_ID}`);
  console.log('  arquivo:', file);
  console.log(
    `  long/RF: ${payload.opening_positions?.length ?? 0} | shorts: ${payload.opening_short_options?.length ?? 0}`
  );

  const result = await ledger.importOpeningOnly(ctx, payload);
  console.log('OK:', JSON.stringify(result, null, 2));

  const [assets] = await pool.query(
    `SELECT asset_ticker, current_quantity, managerial_avg_price, status
     FROM invest_assets WHERE organization_id = ? AND status = 'active'
     ORDER BY asset_ticker`,
    [ORG_ID]
  );
  console.log('Custódia ativa:', JSON.stringify(assets, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
