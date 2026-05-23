/**
 * Diagnóstico: lançamentos de caixa no livro (org holding).
 * Uso: npx ts-node scripts/check-cash-ledger.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const evs = await ledger.listLedgerEvents(ctx, '2000-01-01', '2027-01-01');
  const cash = evs.filter((e) => String(e.asset_type) === 'cash');
  console.log('Eventos de caixa:', cash.length);
  for (const e of cash.slice(0, 20)) {
    console.log(
      e.transaction_date,
      e.transaction_type,
      e.asset_ticker,
      e.total_net_value ?? e.quantity
    );
  }
  if (cash.length > 20) console.log(`... +${cash.length - 20} mais`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
