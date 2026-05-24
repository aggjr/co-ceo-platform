/**
 * Compara patrimônio econômico (livro × cotação) vs curva calibrada BTG dia a dia.
 *
 *   npx ts-node scripts/diagnose-patrimony-curve.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { PatrimonyMonthlyAnchorsRepository } from '../src/core/invest/PatrimonyMonthlyAnchorsRepository';
import {
  fixedIncomeTotalFromLedger,
  shouldUseBtgAnchorCalibration,
} from '../src/core/invest/patrimonyLedgerGates';
import { interpolatePatrimonyTarget } from '../src/core/invest/patrimonyAnchors';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const FROM = process.env.PATRIMONY_FROM || '2025-12-31';
const TO = process.env.PATRIMONY_TO || '2026-05-23';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
  const anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  const anchors = await anchorsRepo.loadForOrganization(ctx);
  const events = await ledger.listLedgerEvents(ctx, FROM, TO);

  const calibrate = shouldUseBtgAnchorCalibration(events) && anchors.month_ends.length > 0;
  const economic = buildDailyPatrimonyMtmSeries(events, FROM, TO, {
    anchors,
    fixedIncomeTotal: fixedIncomeTotalFromLedger(events),
    calibrateToAnchors: false,
  });
  const btg = buildDailyPatrimonyMtmSeries(events, FROM, TO, {
    anchors,
    fixedIncomeTotal: Number(anchors.fixed_income_total ?? 0),
    calibrateToAnchors: calibrate,
  });

  console.log('Âncoras:', anchors.month_ends.length, 'pontos; RF', brl(Number(anchors.fixed_income_total ?? 0)));
  console.log('Período', FROM, '→', TO, '| calibração BTG:', calibrate ? 'sim' : 'não');
  console.log('\nData        | Alvo BTG      | Econômico     | BTG calibrado | Δ eco vs alvo');
  console.log('------------|---------------|---------------|---------------|------------');

  const sampleDates = new Set<string>();
  for (const a of anchors.month_ends) sampleDates.add(a.date);
  for (const p of economic.series) {
    if (p.date.endsWith('-01') || p.date.endsWith('-15')) sampleDates.add(p.date);
  }
  sampleDates.add(FROM);
  sampleDates.add(TO);

  for (const date of [...sampleDates].sort()) {
    const eco = economic.series.find((p) => p.date === date);
    const cal = btg.series.find((p) => p.date === date);
    const target = interpolatePatrimonyTarget(date, anchors);
    if (!eco && !cal && target === 0) continue;
    const ecoP = eco?.patrimony ?? 0;
    const calP = cal?.patrimony ?? 0;
    const delta = Math.round((ecoP - target) * 100) / 100;
    console.log(
      `${date} | ${brl(target).padStart(13)} | ${brl(ecoP).padStart(13)} | ${brl(calP).padStart(13)} | ${brl(delta).padStart(11)}`
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
