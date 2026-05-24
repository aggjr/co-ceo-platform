/**
 * Gera série patrimonial diária 2026 e grava em data/invest/patrimony-daily-2026.json.
 * Com --persist, grava também em invest_portfolio_daily (cache; API não recalcula esses dias).
 *
 *   node ./node_modules/ts-node/dist/bin.js scripts/build-patrimony-daily-2026.ts
 *   node ./node_modules/ts-node/dist/bin.js scripts/build-patrimony-daily-2026.ts --persist
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { HOLDING_BTG_PATRIMONY_ANCHORS } from '../src/core/invest/btgPatrimonyAnchorReference';
import { PatrimonyMonthlyAnchorsRepository } from '../src/core/invest/PatrimonyMonthlyAnchorsRepository';
import { PatrimonyDailyStore } from '../src/core/invest/PatrimonyDailyStore';
import { aggregateExternalFlowsByDate } from '../src/core/invest/portfolioPerformance';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const persistDb = process.argv.includes('--persist');

function roundTwr(n: number): number {
  return Math.round(n * 10000) / 10000;
}

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

  const anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  const anchors = await anchorsRepo.loadForOrganization(ctx);
  const events = await ledger.listLedgerEvents(ctx, '2025-12-01', '2026-12-31');
  const calibrate =
    anchors.month_ends.length > 0 &&
    events.some((e) => String(e.transaction_type) === 'opening_balance');
  const result = buildDailyPatrimonyMtmSeries(events, '2026-01-01', '2026-12-31', {
    anchors: anchors.month_ends.length ? anchors : HOLDING_BTG_PATRIMONY_ANCHORS,
    stockQuotes,
    fixedIncomeTotal: Number(anchors.fixed_income_total ?? HOLDING_BTG_PATRIMONY_ANCHORS.fixed_income_total ?? 0),
    calibrateToAnchors: calibrate,
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

  if (persistDb) {
    const today = new Date().toISOString().slice(0, 10);
    const store = new PatrimonyDailyStore(gateway);
    const flowsByDate = aggregateExternalFlowsByDate(events, '2026-01-01', today);
    const fixedIncomeTotal = Number(anchors.fixed_income_total ?? 0);
    let prevPatrimony: number | null = null;
    let cumulativeTwr = 0;
    let persisted = 0;

    for (const point of result.series) {
      if (point.date > today) continue;
      const externalFlow = flowsByDate.get(point.date) ?? 0;
      let dailyReturnTwr = 0;
      if (prevPatrimony != null && prevPatrimony > 0) {
        dailyReturnTwr = roundTwr((point.patrimony - prevPatrimony - externalFlow) / prevPatrimony);
        cumulativeTwr = roundTwr((1 + cumulativeTwr) * (1 + dailyReturnTwr) - 1);
      }
      await store.upsertPortfolioDay(ctx, {
        snapshotDate: point.date,
        point,
        patrimonyGross: point.patrimonyGross,
        fixedIncomeTotal,
        externalFlow,
        dailyReturnTwr,
        cumulativeTwr,
        quotesAsOf: null,
        positionSnapshots: point.date === today ? (result.positionSnapshots ?? []) : [],
        stockQuotes,
      });
      prevPatrimony = point.patrimony;
      persisted++;
    }
    console.log(`Persistidos em invest_portfolio_daily: ${persisted} dia(s) até ${today}`);
  }

  if (result.performance) {
    const p = result.performance;
    console.log('\nResultado 2026 (YTD):');
    console.log('  Patrimônio inicial:', p.startPatrimony.toLocaleString('pt-BR'));
    console.log('  Patrimônio final (série):', p.endPatrimony.toLocaleString('pt-BR'));
    console.log('  Ganho BRL:', p.periodGainBrl.toLocaleString('pt-BR'));
    console.log('  TWR (âncoras mensais BTG):', `${(p.periodReturnTwr * 100).toFixed(2)}%`);
    if (p.monthAnchorTwr != null) {
      console.log('  TWR âncoras (confirmação):', `${(p.monthAnchorTwr * 100).toFixed(2)}%`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
