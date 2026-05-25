/**
 * Diagnóstico: strikes no banco vs o que a API montaria para org-holding-001.
 * npx ts-node scripts/diagnose-options-strike-db.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { loadOptionMarketCatalog } from '../src/core/invest/optionMarketCatalog';
import { buildOptionStrikeMapFromLedgerEvents } from '../src/core/invest/optionStrikeFromLedger';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { resolveOptionStrike } from '../src/core/invest/optionStrike';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const SAMPLE = ['PRIOF760', 'PRIOF750', 'ITUBF422', 'WEGER441', 'PRIOR407'];

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const [marketCount] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM invest_options_market'
  );
  console.log(`\nBanco: ${host}`);
  console.log(`invest_options_market: ${marketCount[0]?.c ?? 0} linhas\n`);

  const catalog = await loadOptionMarketCatalog(gateway, ORG);
  console.log(`loadOptionMarketCatalog: ${catalog.size} tickers com strike > 0\n`);

  for (const t of SAMPLE) {
    const row = catalog.get(t);
    console.log(
      `  ${t}: market=${row ? row.strikePrice : '—'} underlying=${row?.underlyingTicker ?? '—'}`
    );
  }

  const ledger = new LedgerImportService(gateway);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const ledgerStrike = buildOptionStrikeMapFromLedgerEvents(events);

  const [options] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT pi.identifier AS ticker, pi.asset_type, pie.metadata
     FROM patrimony_items pi
     LEFT JOIN invest_position_ext pie ON pie.patrimony_item_id = pi.id
     WHERE pi.organization_id = ? AND pi.source_module = 'INVEST'
       AND (pi.asset_type IN ('option_call','option_put') OR pi.identifier REGEXP '[A-Z]{4}[A-X][0-9]')
     LIMIT 40`,
    [ORG]
  );

  console.log(`\nOpções em patrimony_items (amostra ${options.length}):\n`);
  let withStrike = 0;
  for (const r of options.slice(0, 15)) {
    const ticker = String(r.ticker).toUpperCase();
    let meta: Record<string, unknown> = {};
    try {
      meta = r.metadata ? JSON.parse(String(r.metadata)) : {};
    } catch {
      meta = {};
    }
    const resolved = resolveOptionStrike({
      meta,
      ticker,
      marketStrike: catalog.get(ticker)?.strikePrice,
      ledgerExerciseStrike: ledgerStrike.get(ticker),
    });
    if (resolved.strike != null) withStrike += 1;
    console.log(
      `  ${ticker.padEnd(12)} strike=${resolved.strike ?? '—'} source=${resolved.source ?? '—'} meta=${meta.option_strike ?? '—'}`
    );
  }
  console.log(`\nCom strike resolvível (amostra 15): ${withStrike}/15`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
