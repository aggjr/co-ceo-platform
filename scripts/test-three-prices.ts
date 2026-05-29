import 'dotenv/config';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway, UserContext } from '../src/core/dal';
import { LedgerEventProjection } from '../src/modules/invest/sync/LedgerEventProjection';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';

const HOLDING_ORG_ID = 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const gateway = new CoCeoDataGateway(pool);
  const projection = new LedgerEventProjection(gateway);

  const ctx: UserContext = {
    userId: 'system',
    organizationId: HOLDING_ORG_ID,
    impersonatorId: null,
    scope: 'global',
  };

  const events = await projection.listLedgerEvents(ctx, '2000-01-01', '2026-12-31');
  const snaps = computeThreePricesByUnderlying(events);

  console.log('--- ENGINE SNAPSHOTS ---');
  for (const [k, v] of snaps.entries()) {
    console.log(`TICKER: ${k} | Qty: ${v.qty} | Estrito: ${v.estrito.toFixed(4)} | B3: ${v.b3.toFixed(4)} | Gerencial: ${v.gerencial.toFixed(4)}`);
  }

  await pool.end();
}

main().catch(console.error);
