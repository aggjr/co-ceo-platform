/**
 * Importa ordens de opçães executadas em 20/05/2026.
 * Uso: npx ts-node scripts/import-may20-orders.ts
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  const entries = [
    {
      date: '2026-05-20',
      ticker: 'WEGEF476',
      asset_type: 'option' as const,
      operation: 'sell' as const,
      quantity: -1000,
      unit_price: 0.29,
      total_gross_value: 290,
      total_net_value: 290,
      brokerage_fee: 0,
      b3_fees: 0,
      irrf_tax: 0,
    },
    {
      date: '2026-05-20',
      ticker: 'ITUBF435',
      asset_type: 'option' as const,
      operation: 'sell' as const,
      quantity: -500,
      unit_price: 0.24,
      total_gross_value: 120,
      total_net_value: 120,
      brokerage_fee: 0,
      b3_fees: 0,
      irrf_tax: 0,
    },
    {
      date: '2026-05-20',
      ticker: 'BBASF224',
      asset_type: 'option' as const,
      operation: 'sell' as const,
      quantity: -500,
      unit_price: 0.18,
      total_gross_value: 90,
      total_net_value: 90,
      brokerage_fee: 0,
      b3_fees: 0,
      irrf_tax: 0,
    },
    {
      date: '2026-05-20',
      ticker: 'BBASF231',
      asset_type: 'option' as const,
      operation: 'sell' as const,
      quantity: -700,
      unit_price: 0.08,
      total_gross_value: 56,
      total_net_value: 56,
      brokerage_fee: 0,
      b3_fees: 0,
      irrf_tax: 0,
    }
  ];

  console.log('Inserindo ordens executadas em 20/05/2026...');
  
  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'Ordens manuais (Prints) 20/05/2026',
  });

  console.log('Resultado:', result);

  await pool.end();
}

main().catch(console.error);
