/**
 * Grava strikes/vencimento no invest_options_market (capturas MyProfit mai/2026).
 * Usar quando sync:options:market (opcoes.net) estiver lento/indisponível.
 *
 * npx ts-node scripts/seed-options-market-capturas.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { OptionMarketRepository } from '../src/core/invest/OptionMarketRepository';
import { inferUnderlyingTicker } from '../src/core/invest/assetClassifier';
import { inferOptionMonthFromTicker } from '../src/core/invest/optionExpiry';
import type { ParsedOptionMarketRow } from '../src/core/invest/opcoesNetChainParser';

dotenv.config();

const EXPIRY = '2026-06-19';

const STRIKES: Record<string, number> = {
  BBASF224: 22.1,
  BBASF231: 22.85,
  ITUBF422: 41.94,
  ITUBF427: 42.44,
  ITUBF432: 42.94,
  ITUBF435: 43.19,
  ITUBF437: 43.44,
  ITUBF445: 44.19,
  ITUBR416: 37.9,
  ITUBR424: 38.63,
  ITUBR431: 39.36,
  ITUBR436: 39.84,
  PRIOF740: 74.0,
  PRIOF750: 75.0,
  PRIOF755: 75.5,
  PRIOF760: 76.0,
  PRIOF770: 77.0,
  PRIOF775: 77.5,
  PRIOF780: 78.0,
  PRIOF785: 78.5,
  PRIOF800: 80.0,
  PRIOF820: 82.0,
  PRIOR407: 40.75,
  PRIOR560: 56.0,
  PRIOR580: 58.0,
  PRIOR590: 59.0,
  PRIOR605: 60.5,
  WEGEF476: 47.53,
  WEGER441: 41.03,
  WEGER417: 41.78,
  WEGER435: 43.53,
  WEGER448: 42.78,
};

function toRow(ticker: string, strike: number): ParsedOptionMarketRow | null {
  const month = inferOptionMonthFromTicker(ticker);
  if (!month) return null;
  return {
    ticker,
    underlyingTicker: inferUnderlyingTicker(ticker),
    optionType: month.optionSide === 'put' ? 'PUT' : 'CALL',
    strikePrice: strike,
    expirationDate: EXPIRY,
    europeanAmerican: 'A',
  };
}

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const repo = new OptionMarketRepository(gateway);

  const rows: ParsedOptionMarketRow[] = [];
  for (const [ticker, strike] of Object.entries(STRIKES)) {
    const row = toRow(ticker.toUpperCase(), strike);
    if (row) rows.push(row);
  }

  const result = await repo.upsertMany(ctx, rows);
  console.log(`invest_options_market @ ${host}: +${result.inserted} / ~${result.updated}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
