require('dotenv').config();
const mysql = require('mysql2/promise');
const { CoCeoDataGateway } = require('../dist/core/dal');
const { LedgerImportService } = require('../dist/core/invest/LedgerImportService');
const { buildThreeAvgPricesByUnderlying } = require('../dist/core/invest/portfolioThreePrices');
const { rebuildCustodyFromLedger } = require('../dist/core/invest/CustodyEngine');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = {
    userId: 'installer',
    organizationId: process.env.PORTFOLIO_ORG_ID || 'org-holding-001',
    scope: 'node',
    roleId: 'role-admin',
  };
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const three = buildThreeAvgPricesByUnderlying(events);
  const { assets } = rebuildCustodyFromLedger(events);
  for (const t of ['ITUB4', 'BBAS3', 'WEGE3', 'PRIO3']) {
    const p = three.get(t);
    const c = assets.find((a) => a.ticker === t);
    console.log(t, {
      qty: c?.quantity,
      estrito: p?.estrito,
      b3: p?.b3,
      gerencial: p?.gerencial,
      b3Diff: p ? p.estrito - p.b3 : null,
      gerDiff: p ? p.b3 - p.gerencial : null,
    });
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
