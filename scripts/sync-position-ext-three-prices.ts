/**
 * Sincroniza pm_estrito / pm_b3 / pm_gerencial em invest_position_ext
 * a partir do threePricesEngine (livro patrimonial).
 *
 *   npx ts-node scripts/sync-position-ext-three-prices.ts --dry-run
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import { inferUnderlyingTicker } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const prices = computeThreePricesByUnderlying(events);

  const [exts] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ipe.patrimony_item_id, pi.identifier AS ticker, ipe.asset_class
     FROM invest_position_ext ipe
     JOIN patrimony_items pi ON pi.id = ipe.patrimony_item_id
     WHERE ipe.organization_id = ?`,
    [ORG]
  );

  let updated = 0;
  for (const row of exts) {
    const ticker = String(row.ticker || '').toUpperCase();
    const cls = String(row.asset_class || '');
    if (cls === 'option_call' || cls === 'option_put') continue;
    const und = inferUnderlyingTicker(ticker);
    const p = prices.get(und) || prices.get(ticker);
    if (!p || p.qty <= 0) continue;

    console.log(
      `${dryRun ? '[dry-run]' : 'sync'} ${ticker}: E=${p.estrito.toFixed(4)} B3=${p.b3.toFixed(4)} G=${p.gerencial.toFixed(4)}`
    );
    if (!dryRun) {
      await gateway.update(ctx, 'invest_position_ext', String(row.patrimony_item_id), {
        pm_estrito: p.estrito,
        pm_b3: p.b3,
        pm_gerencial: p.gerencial,
      });
    }
    updated += 1;
  }

  console.log(`\nAtualizados: ${updated}`);
  const prio = prices.get('PRIO3');
  if (prio) {
    console.log(
      `PRIO3 engine: qty=${prio.qty} E=${prio.estrito} B3=${prio.b3} Ger=${prio.gerencial}`
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
