/**
 * Sincroniza pm_estrito / pm_b3 / pm_gerencial em invest_position_ext
 * a partir do threePricesEngine (livro patrimonial).
 * Cria invest_position_ext quando o papel ainda não tem ext (ações/FII em carteira).
 *
 *   npx ts-node scripts/sync-position-ext-three-prices.ts --dry-run
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import { inferAssetType, inferUnderlyingTicker } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const STOCK_LIKE = new Set(['stock', 'fii']);

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

  const [items] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT pi.id AS patrimony_item_id, pi.identifier AS ticker, pi.subcategory,
            pi.quantity, ipe.patrimony_item_id AS ext_id, ipe.asset_class AS ext_class
     FROM patrimony_items pi
     LEFT JOIN invest_position_ext ipe ON ipe.patrimony_item_id = pi.id
     WHERE pi.organization_id = ? AND pi.source_module = 'INVEST' AND pi.status = 'active'`,
    [ORG]
  );

  let updated = 0;
  let created = 0;

  for (const row of items) {
    const ticker = String(row.ticker || '').toUpperCase();
    if (!ticker || ticker.startsWith('CAIXA-')) continue;

    const sub = String(row.subcategory || '');
    const extClass = row.ext_class ? String(row.ext_class) : '';
    const assetClass =
      extClass ||
      (STOCK_LIKE.has(sub) ? sub : inferAssetType(ticker));
    if (assetClass === 'option_call' || assetClass === 'option_put') continue;

    const und = inferUnderlyingTicker(ticker);
    const p = prices.get(und) || prices.get(ticker);
    if (!p || p.qty <= 0) continue;

    const payload = {
      asset_class: assetClass,
      underlying_ticker: und !== ticker ? und : null,
      pm_estrito: p.estrito,
      pm_b3: p.b3,
      pm_gerencial: p.gerencial,
    };

    const hasExt = row.ext_id != null;
    const action = hasExt ? 'sync' : 'create';
    console.log(
      `${dryRun ? '[dry-run]' : action} ${ticker}: E=${p.estrito.toFixed(4)} B3=${p.b3.toFixed(4)} G=${p.gerencial.toFixed(4)}`
    );

    if (!dryRun) {
      const itemId = String(row.patrimony_item_id);
      if (hasExt) {
        await gateway.update(ctx, 'invest_position_ext', itemId, payload);
        updated += 1;
      } else {
        await gateway.insert(ctx, 'invest_position_ext', {
          patrimony_item_id: itemId,
          ...payload,
        });
        created += 1;
      }
    } else {
      if (hasExt) updated += 1;
      else created += 1;
    }
  }

  console.log(`\nAtualizados: ${updated} · Criados: ${created}`);
  for (const t of ['PRIO3', 'ITUB4', 'BBAS3', 'WEGE3']) {
    const p = prices.get(t);
    if (p?.qty) {
      console.log(`${t}: qty=${p.qty} E=${p.estrito} B3=${p.b3} Ger=${p.gerencial}`);
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
