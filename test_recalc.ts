import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from './src/core/dal/CoCeoDataGateway';
import { LedgerImportService } from './src/core/invest/LedgerImportService';

async function test() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = {
    userId: 'system',
    organizationId: 'org-holding-001',
    impersonatorId: null,
    scope: 'global' as const,
  };

  const ledgerService = new LedgerImportService(gateway);
  const events = await ledgerService.listLedgerEvents(ctx, '2000-01-01', '2026-12-31');
  
  for (const e of events) {
    console.log(`${e.event_date} | ${e.asset_ticker} | ${e.transaction_type} | qty: ${e.quantity} | cost: ${e.total_net_value}`);
  }
  
  await pool.end();
}

test().then(() => process.exit(0)).catch(console.error);
