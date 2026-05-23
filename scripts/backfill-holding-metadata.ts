/**
 * Backfill: broker_note_ref em abertura patrimonial + invest_option_ext (strike).
 *
 *   npx ts-node scripts/backfill-holding-metadata.ts --dry-run
 *   npx ts-node scripts/backfill-holding-metadata.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { inferOptionExpiryDate } from '../src/core/invest/optionExpiry';
import { inferAssetType } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const OPENING_BATCH = 'OPENING-BTG-2026-01-01';

const OPENING_OPTIONS: Array<{
  ticker: string;
  strike: number;
  underlying: string;
  type: 'CALL' | 'PUT';
}> = [
  { ticker: 'PRIOQ43', strike: 43, underlying: 'PRIO3', type: 'PUT' },
  { ticker: 'PRIOR407', strike: 40.7, underlying: 'PRIO3', type: 'PUT' },
  { ticker: 'PRIOA407', strike: 40.7, underlying: 'PRIO3', type: 'CALL' },
];

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
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const [pleRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ple.id, ple.patrimony_item_id, ple.movement_type, ple.metadata, ple.external_ref,
            pi.identifier AS ticker
     FROM patrimony_ledger_entries ple
     JOIN patrimony_items pi ON pi.id = ple.patrimony_item_id
     WHERE ple.organization_id = ? AND ple.deleted_at IS NULL
       AND ple.movement_type = 'opening_balance'
       AND ple.transaction_date = '2026-01-01'`,
    [ORG]
  );

  let pleUpdated = 0;
  for (const row of pleRows) {
    const ticker = String(row.ticker || '').toUpperCase();
    const ref = `${OPENING_BATCH}:${ticker}`;
    const meta =
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata || '{}')
        : row.metadata || {};
    if (meta.broker_note_ref === ref && row.external_ref === `BROKER_REF:${ref}`) continue;

    const patch = {
      ...meta,
      legacy_op: 'opening_balance',
      broker_note_ref: ref,
    };
    console.log(`${dryRun ? '[dry-run]' : 'PLE'} ${ticker} → ${ref}`);
    if (!dryRun) {
      await gateway.update(ctx, 'patrimony_ledger_entries', String(row.id), {
        metadata: patch,
        external_ref: `BROKER_REF:${ref}`,
      });
    }
    pleUpdated += 1;
  }

  let optExt = 0;
  for (const spec of OPENING_OPTIONS) {
    const [items] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM patrimony_items
       WHERE organization_id = ? AND identifier = ? AND deleted_at IS NULL`,
      [ORG, spec.ticker]
    );
    if (!items.length) {
      console.warn('Item ausente:', spec.ticker);
      continue;
    }
    const itemId = String(items[0]!.id);
    const [ext] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT patrimony_item_id, strike_price FROM invest_option_ext
       WHERE organization_id = ? AND patrimony_item_id = ?`,
      [ORG, itemId]
    );
    const exp = inferOptionExpiryDate(spec.ticker, 2026);
    if (ext.length && Number(ext[0]!.strike_price) === spec.strike) continue;

    console.log(
      `${dryRun ? '[dry-run]' : 'OPT'} ${spec.ticker} strike=${spec.strike} exp=${exp}`
    );
    if (!dryRun) {
      if (ext.length) {
        await gateway.update(ctx, 'invest_option_ext', itemId, {
          strike_price: spec.strike,
          expiration_date: exp,
          underlying_ticker: spec.underlying,
          option_type: spec.type,
        });
      } else {
        await gateway.insert(ctx, 'invest_option_ext', {
          organization_id: ORG,
          patrimony_item_id: itemId,
          option_type: spec.type,
          underlying_ticker: spec.underlying,
          strike_price: spec.strike,
          expiration_date: exp,
          european_american: 'E',
        });
      }
    }
    optExt += 1;
  }

  console.log(`\nPLE atualizados: ${pleUpdated} | option_ext: ${optExt}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
