import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { LedgerEventProjection } from '../src/modules/invest/sync/LedgerEventProjection';
import { settledCashBalanceFromLedger } from '../src/core/invest/cashInvestLedger';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const gw = new CoCeoDataGateway(pool);
  const proj = new LedgerEventProjection(gw);
  
  const ctx = { organizationId: 'org-holding-001' } as any;
  const events = await proj.listLedgerEvents(ctx, '2000-01-01', '2026-05-31');
  
  console.log('Balance up to 2025-12-31:', settledCashBalanceFromLedger(events, '2025-12-31').toFixed(2));
  console.log('Balance up to 2026-01-31:', settledCashBalanceFromLedger(events, '2026-01-31').toFixed(2));
  console.log('Balance up to 2026-02-28:', settledCashBalanceFromLedger(events, '2026-02-28').toFixed(2));
  console.log('Balance up to 2026-03-31:', settledCashBalanceFromLedger(events, '2026-03-31').toFixed(2));
  console.log('Balance up to 2026-04-30:', settledCashBalanceFromLedger(events, '2026-04-30').toFixed(2));
  console.log('Balance up to 2026-05-31:', settledCashBalanceFromLedger(events, '2026-05-31').toFixed(2));
  
  await pool.end();
}

main().catch(console.error);
