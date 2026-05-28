import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { LedgerEventProjection } from '../src/modules/invest/sync/LedgerEventProjection';

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
  const events = await proj.listLedgerEvents(ctx, '2000-01-01', '2026-03-31');
  
  let balance = 0;
  for (const e of events) {
    if (e.asset_type === 'cash') {
      const amt = Number(e.total_net_value) || 0;
      const isOut = ['buy', 'capital_withdrawal', 'fee', 'call_buy', 'put_buy', 'penalty_b3'].includes(e.transaction_type);
      const net = isOut ? -amt : amt;
      balance += net;
      if (e.transaction_date! >= '2026-03-01' && e.transaction_date! <= '2026-03-31') {
        // console.log(`${e.transaction_date} | ${e.transaction_type} | ${net} | ${e.asset_ticker}`);
      }
    }
  }
  
  console.log(`Final cash balance on 2026-03-31: ${balance.toFixed(2)}`);
  
  await pool.end();
}

main().catch(console.error);
