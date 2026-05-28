/**
 * Lista lançamentos CAIXA* em um intervalo de datas.
 * npx ts-node scripts/audit-cash-date-range.ts 2026-05-14 2026-05-19
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { isCashInvestTicker } from '../src/core/invest/cashInvestLedger';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const from = process.argv[2] || '2026-05-14';
  const to = process.argv[3] || '2026-05-19';

  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const events = await ledger.listLedgerEvents(ctx, from, to);
  const cash = events
    .filter((e) => isCashInvestTicker(String(e.asset_ticker)))
    .sort((a, b) =>
      String(a.transaction_date).localeCompare(String(b.transaction_date)) ||
      Number(b.total_net_value) - Number(a.total_net_value)
    );

  console.log(`CAIXA ${from} → ${to}: ${cash.length} lançamentos\n`);
  let sum = 0;
  for (const e of cash) {
    const v = Number(e.total_net_value ?? 0);
    sum += v;
    console.log(
      `${e.transaction_date} ${brl(v).padStart(14)} ${String(e.transaction_type).padEnd(22)} ref=${e.broker_note_ref || '—'}`
    );
    if (e.notes) console.log(`    ${String(e.notes).slice(0, 90)}`);
  }
  console.log(`\nSoma período: ${brl(Math.round(sum * 100) / 100)}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
