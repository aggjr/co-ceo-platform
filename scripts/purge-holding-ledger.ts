/**
 * Zera o módulo INVEST de uma organização (livro-razão + projeções + fechamentos diários).
 * Custódia em invest_assets é recalculada (qty 0 / liquidated).
 *
 * Uso: npx ts-node scripts/purge-holding-ledger.ts
 *      PORTFOLIO_ORG_ID=org-holding-001 npx ts-node scripts/purge-holding-ledger.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  console.log(`Zerando INVEST para organização: ${ORG}`);

  const [ledgerRes] = await pool.query(
    'DELETE FROM invest_ledger_entries WHERE organization_id = ?',
    [ORG]
  );
  const ledgerDeleted = (ledgerRes as { affectedRows: number }).affectedRows;
  console.log('Lançamentos removidos:', ledgerDeleted);

  let dailyDeleted = 0;
  try {
    const [dailyRes] = await pool.query(
      'DELETE FROM invest_portfolio_daily WHERE organization_id = ?',
      [ORG]
    );
    dailyDeleted = (dailyRes as { affectedRows: number }).affectedRows;
    console.log('Fechamentos diários removidos:', dailyDeleted);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("doesn't exist")) throw e;
    console.log('Tabela invest_portfolio_daily ausente — ignorado.');
  }

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const reconcile = await ledger.reconcileCustody(ctx);
  console.log('Custódia reconciliada:', reconcile);

  const [activeRows] = await pool.query(
    `SELECT COUNT(1) AS n FROM invest_assets
     WHERE organization_id = ? AND status = 'active' AND ABS(current_quantity) > 0.0001`,
    [ORG]
  );
  const activeWithQty = Number((activeRows as { n: number }[])[0]?.n ?? 0);
  console.log('Ativos ativos com qty > 0 após purge:', activeWithQty);

  await pool.end();
  console.log('\nPatrimônio diário na UI passa a refletir só o livro (sem curva BTG fantasma).');
  console.log('Próximo passo: preencher data/invest/opening-ir-2026-01-01.json e rodar');
  console.log('  npx ts-node scripts/import-opening-augusto.ts');
  console.log('Depois de cada dia com cotações: npx ts-node scripts/record-daily-patrimony.ts');
}

main().catch((err) => {
  console.error('Erro ao zerar base INVEST:', err);
  process.exit(1);
});
