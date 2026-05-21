/**
 * Importa ordens RV/opções somente do home broker BTG Pactual (notas B3_BTG).
 * Uso: npx ts-node scripts/import-btg-orders-augusto.ts [caminho.xlsx]
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  normalizeBtgOrdersPayload,
  parseBtgHomeBrokerHistoricalFile,
} from '../src/core/invest/btgHomeBrokerImport';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const JSON_PATH = path.join(__dirname, '..', 'data', 'invest', 'btg-orders-augusto-h1-2026.json');
const DEFAULT_XLSX =
  'c:/Users/aggjr/Downloads/myProfit - Relatório Histórico de investimentos - 122025-052026.xlsx';

async function main() {
  let entries: LedgerImportLine[];
  const xlsxArg = process.argv[2];
  if (xlsxArg && fs.existsSync(path.resolve(xlsxArg))) {
    entries = parseBtgHomeBrokerHistoricalFile(path.resolve(xlsxArg), {
      fromDate: '2026-01-01',
    });
  } else if (fs.existsSync(JSON_PATH)) {
    const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as {
      entries?: LedgerImportLine[];
    };
    entries = normalizeBtgOrdersPayload(raw.entries || []);
  } else {
    console.error('Informe xlsx BTG ou gere', JSON_PATH, 'antes.');
    process.exit(1);
  }

  console.log(`BTG home broker → ${entries.length} lançamentos (somente B3_BTG Pactual)`);

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'BTG Pactual home broker jan–mai/2026',
  });

  console.log('OK:', JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
