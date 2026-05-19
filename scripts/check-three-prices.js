require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const ORG = 'org-holding-001';

(async () => {
  require('ts-node/register');
  const { CoCeoDataGateway } = require('../src/core/dal');
  const { installerContext } = require('../src/database/seeds/lib/installerContext');
  const { LedgerImportService } = require('../src/core/invest/LedgerImportService');
  const { buildThreeAvgPricesByUnderlying } = require('../src/core/invest/portfolioThreePrices');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' };
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const three = buildThreeAvgPricesByUnderlying(events);

  const snap = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/invest/snapshot-btg-quotes-current.json'), 'utf8')
  );

  const [assets] = await pool.query(
    `SELECT asset_ticker, current_quantity, managerial_avg_price
     FROM invest_assets WHERE organization_id=? AND asset_ticker IN ('BBAS3','ITUB4','WEGE3','PRIO3')`,
    [ORG]
  );

  console.log('Ticker | Qtd ledger | BTG avg | Estrito | B3 | Gerencial | Custódia');
  for (const row of assets) {
    const t = row.asset_ticker;
    const p = three.get(t) || {};
    const btg = snap.renda_variavel.acoes.items.find((i) => i.ticker === t);
    console.log(
      [
        t,
        Number(row.current_quantity),
        btg?.avg_price ?? '-',
        p.strict?.toFixed(4) ?? '-',
        p.b3?.toFixed(4) ?? '-',
        p.managerial?.toFixed(4) ?? '-',
        Number(row.managerial_avg_price).toFixed(4),
      ].join(' | ')
    );
  }

  await pool.end();
})();
