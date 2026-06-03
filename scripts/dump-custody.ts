import { CoCeoDataGateway } from '../src/core/dal/CoCeoDataGateway';
import { createPool } from 'mysql2/promise';
import dotenv from 'dotenv';
import { rebuildCustodyFromLedger } from '../src/core/invest/CustodyEngine';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

async function run() {
  const pool = createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'co_ceo',
  });
  const gateway = new CoCeoDataGateway(pool);
  
  // Just query the raw ledger events
  const ledgerSvc = new LedgerImportService(gateway);
  const ctx: any = { userId: "test", impersonatorId: "test", scope: "global", organizationId: '2b0a33c2-d119-4cb5-b44e-a10e6e7683d7' }; // Usually the first org
  
  // Try to find the org ID
  const [orgs] = await pool.query('SELECT id FROM organizations LIMIT 1', []) as any;
  if (orgs.length > 0) {
    ctx.organizationId = orgs[0].id;
  }
  
  const events = await ledgerSvc.listLedgerEvents(ctx, '2000-01-01', '2026-12-31');
  const custody = rebuildCustodyFromLedger(events);
  
  console.log("Current DB Custody:");
  for (const c of custody.assets) {
    if (c.assetType !== 'cash') {
      console.log(`${c.ticker} (${c.assetType}): ${c.quantity}`);
    }
  }
  
  process.exit(0);
}

run().catch(console.error);
