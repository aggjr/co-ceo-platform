/**
 * Lista ações-mãe com opções em custódia (produção via REMOTE_DB_*).
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { inferUnderlyingTicker, isOptionTicker } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });

  const [rows] = await pool.query(
    `SELECT DISTINCT pi.identifier AS ticker
     FROM patrimony_items pi
     WHERE pi.source_module = 'INVEST'
       AND pi.status = 'active'
       AND pi.deleted_at IS NULL
       AND pi.organization_id = ?
       AND ABS(pi.quantity) > 0.0001
       AND pi.identifier REGEXP '^[A-Z]{4}[A-X][0-9]'
     ORDER BY pi.identifier`,
    [ORG]
  );

  const allTickers = (rows as Array<{ ticker: string }>).map((r) =>
    String(r.ticker ?? '').toUpperCase()
  );
  const tickers = allTickers.filter((t) => isOptionTicker(t));
  const missed = allTickers.filter((t) => !isOptionTicker(t) && /^[A-Z]{4}[A-X]/i.test(t));

  const underlyings = [...new Set(tickers.map((t) => inferUnderlyingTicker(t)))].sort();
  const underlyingsFromMissed = [
    ...new Set(missed.map((t) => inferUnderlyingTicker(t))),
  ].sort();

  console.log(`Banco: ${host} | org: ${ORG}`);
  console.log(`Itens ativos (join ext): ${allTickers.length}`);
  console.log(`Opções em custódia (classificador): ${tickers.length}`);
  if (missed.length) {
    console.log(`Possíveis opções não classificadas (${missed.length}): ${missed.slice(0, 8).join(', ')}${missed.length > 8 ? '...' : ''}`);
  }
  if (tickers.length) console.log(`Tickers: ${tickers.join(', ')}`);
  console.log(`Ações-mãe: ${underlyings.join(', ')}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
