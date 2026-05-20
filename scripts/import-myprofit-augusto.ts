/**
 * Importa movimentações myProfit (jan–mai/2026) sem duplicar notas já no ledger.
 * Uso: npx ts-node scripts/import-myprofit-augusto.ts [caminho.xlsx]
 */
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { parseMyProfitHistoricalFile } from '../src/core/invest/MyProfitHistoricalParser';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const DEFAULT_XLSX =
  'c:/Users/aggjr/Downloads/myProfit - Relatório Histórico de investimentos - 122025-052026.xlsx';

async function main() {
  const filePath = path.resolve(process.argv[2] || DEFAULT_XLSX);
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  const allDates = process.argv.includes('--all-dates');
  const fromDate = allDates ? undefined : fromArg?.split('=')[1] || '2026-01-01';
  const entries = parseMyProfitHistoricalFile(
    filePath,
    fromDate ? { fromDate } : undefined
  );

  console.log(
    `myProfit → ${entries.length} lançamentos` +
      (fromDate ? ` (desde ${fromDate})` : ' (todas as datas)') +
      ' — sem Tesouro/locação duplicados'
  );

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

  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'myProfit histórico 12/2025–05/2026',
  });

  console.log('OK:', JSON.stringify(result, null, 2));

  const [assets] = await pool.query(
    `SELECT asset_ticker, current_quantity, managerial_avg_price, status
     FROM invest_assets WHERE organization_id = ? AND status = 'active'
       AND asset_ticker IN ('PRIO3','ITUB4','BBAS3','WEGE3','PRIOQ43','PRIOR407','PRIOA407')
     ORDER BY asset_ticker`,
    [ORG_ID]
  );
  console.log('Custódia chave:', JSON.stringify(assets, null, 2));

  const [countRows] = await pool.query(
    'SELECT COUNT(1) AS n FROM invest_ledger_entries WHERE organization_id = ?',
    [ORG_ID]
  );
  const n = Number((countRows as any)[0]?.n ?? 0);
  console.log('Total ledger:', n);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
