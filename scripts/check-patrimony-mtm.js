require('dotenv').config();
const mysql = require('mysql2/promise');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const [rows] = await conn.query(
    `SELECT asset_ticker, asset_type, current_quantity, metadata
     FROM invest_assets WHERE organization_id = ? AND status = 'active'
       AND current_quantity != 0 ORDER BY asset_ticker LIMIT 25`,
    [ORG]
  );
  let mtm = 0;
  for (const r of rows) {
    let meta = r.metadata;
    if (typeof meta === 'string') meta = JSON.parse(meta);
    const lp = Number(meta?.last_price ?? 0);
    const q = Number(r.current_quantity);
    const v = q * lp;
    if (Math.abs(v) > 1) console.log(r.asset_ticker, q, lp, v.toFixed(2));
    mtm += v;
  }
  const [[cash]] = await conn.query(
    `SELECT current_quantity FROM invest_assets WHERE organization_id=? AND asset_ticker='CAIXA-BTG'`,
    [ORG]
  );
  console.log('MTM positions (last_price):', mtm.toFixed(2));
  console.log('CAIXA-BTG qty:', cash?.current_quantity);
  console.log('MTM + cash:', (mtm + Number(cash?.current_quantity || 0)).toFixed(2));
  await conn.end();
})();
