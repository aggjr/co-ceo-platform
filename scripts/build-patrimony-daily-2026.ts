/**
 * Gera série patrimonial diária 2026 e grava em data/invest/patrimony-daily-2026.json
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { loadPatrimonyAnchors } from '../src/core/invest/patrimonyAnchors';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const assets = await gateway.findWhere(ctx, 'invest_assets', {
    organization_id: ORG,
    status: 'active',
  });
  const stockQuotes: Record<string, number> = {};
  for (const row of assets) {
    const ticker = String(row.asset_ticker ?? '').toUpperCase();
    let meta: { last_price?: number } = {};
    if (row.metadata) {
      try {
        meta =
          typeof row.metadata === 'string'
            ? JSON.parse(row.metadata)
            : (row.metadata as { last_price?: number });
      } catch {
        meta = {};
      }
    }
    const lp = Number(meta.last_price ?? row.managerial_avg_price ?? 0);
    if (Number.isFinite(lp) && lp >= 0) stockQuotes[ticker] = lp;
  }

  const anchors = loadPatrimonyAnchors();
  const events = await ledger.listLedgerEvents(ctx, '2025-12-01', '2026-12-31');
  const result = buildDailyPatrimonyMtmSeries(events, '2026-01-01', '2026-12-31', {
    anchors,
    stockQuotes,
    fixedIncomeTotal: Number(anchors.fixed_income_total ?? 0),
  });

  const outPath = path.join(__dirname, '..', 'data', 'invest', 'patrimony-daily-2026.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        organization_id: ORG,
        ...result,
      },
      null,
      2
    )
  );

  const monthEnds = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-18', '2026-05-19', '2026-05-31'];
  console.log('Patrimônio (fim de mês):');
  for (const d of monthEnds) {
    const pt = result.series.find((p) => p.date === d);
    const target = anchors.month_ends.find((m) => m.date === d)?.patrimony;
    console.log(
      d,
      pt?.patrimony?.toFixed(2) ?? '-',
      target != null ? `(BTG ${target.toFixed(2)})` : ''
    );
  }
  console.log('Salvo:', outPath, `(${result.series.length} dias)`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
