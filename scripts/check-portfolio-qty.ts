import 'dotenv/config';
import mysql from 'mysql2/promise';

const tickers = ['PRIO3', 'ITUB4', 'BBAS3', 'WEGE3'];
const org = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function check(label: string, host: string, user: string, password: string, database: string) {
  const conn = await mysql.createConnection({ host, user, password, database });
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT a.asset_ticker, SUM(e.quantity) AS q
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ? AND a.asset_ticker IN (?) AND e.deleted_at IS NULL
     GROUP BY a.asset_ticker`,
    [org, tickers]
  );
  console.log(`\n=== ${label} (${database} @ ${host}) ===`);
  for (const t of tickers) {
    const row = rows.find((r) => r.asset_ticker === t);
    console.log(`${t}: ${row?.q ?? '—'}`);
  }
  await conn.end();
}

(async () => {
  await check('LOCAL', process.env.DB_HOST || 'localhost', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', process.env.DB_NAME || 'co_ceo_platform');
  const pw = process.env.REMOTE_DB_PASSWORD;
  if (pw) {
    await check('SERVER', '69.62.99.34', 'root', pw, 'co_ceo_platform');
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
