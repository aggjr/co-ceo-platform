/**
 * Grava âncoras mensais BTG a partir dos JSON em co_ceo_platform (dados).
 *
 *   npx ts-node scripts/seed-patrimony-anchors-from-dados.ts
 */
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { PatrimonyMonthlyAnchorsSeedService } from '../src/core/invest/PatrimonyMonthlyAnchorsSeedService';
import { buildAnchorFileFromDados } from './lib/patrimony-dados-json';
import { createInvestPool } from './lib/invest-db-pool';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const file = buildAnchorFileFromDados();
  console.log(`Âncoras lidas (${file.month_ends.length} pontos, RF ${file.fixed_income_total}):`);
  for (const p of file.month_ends) {
    console.log(`  ${p.date}  R$ ${p.patrimony.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  }

  const pool = createInvestPool();
  try {
    const gateway = new CoCeoDataGateway(pool);
    const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
    const seed = new PatrimonyMonthlyAnchorsSeedService(gateway);
    const result = await seed.seedFromFile(ctx, file);
    console.log(`\nGravado: ${result.upserted} ponto(s) em invest_patrimony_monthly_anchors.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
