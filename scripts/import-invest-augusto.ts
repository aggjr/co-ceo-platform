/**
 * Importa livro-razão INVEST da holding (Augusto / BTG) via gateway.
 * Uso: npx ts-node scripts/import-invest-augusto.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerImportPayload } from '../src/core/invest/ledgerTypes';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function buildPayload(): LedgerImportPayload {
  const btgPath = path.join(__dirname, '..', 'data', 'invest', 'btg-augusto-h1-2026.json');
  const base = JSON.parse(fs.readFileSync(btgPath, 'utf8')) as LedgerImportPayload;

  const cashOpening = Number(
    (base as { meta?: { cash_opening_2026_01_01?: number } }).meta?.cash_opening_2026_01_01 ??
      58758.79
  );

  base.opening_positions = [
    {
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      quantity: cashOpening,
      avg_price: 1,
    },
  ];

  const pending = {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    asset_type: 'cash' as const,
    operation: 'pending_settlement' as const,
    quantity: 0,
    unit_price: 0,
    total_net_value: 0,
    impacts_managerial_price: false,
    notes: 'Lançamentos futuros BTG — zerado (Necton 18/05/2026)',
  };

  const entries = base.entries || [];
  const hasPending = entries.some((e) => e.operation === 'pending_settlement');
  if (!hasPending) {
    base.entries = [...entries, pending];
  }

  return base;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = installerContext();
  const payload = buildPayload();
  const ledger = new LedgerImportService(gateway);

  console.log(`Importando para org ${ORG_ID}...`);
  console.log(
    `  abertura caixa: R$ ${payload.opening_positions?.[0]?.quantity ?? 0}`,
    `| extratos: ${payload.monthly_statements?.length ?? 0} blocos`
  );

  const result = await ledger.importPortfolio(
    { ...ctx, organizationId: ORG_ID, scope: 'node' },
    payload
  );

  console.log('OK:', JSON.stringify(result, null, 2));

  const [countRows] = await pool.query(
    'SELECT COUNT(1) AS n FROM invest_ledger_entries WHERE organization_id = ?',
    [ORG_ID]
  );
  const [pendingRows] = await pool.query(
    `SELECT COUNT(1) AS p FROM invest_ledger_entries
     WHERE organization_id = ? AND transaction_type = 'pending_settlement'`,
    [ORG_ID]
  );
  const n = Number((countRows as { n: number }[])[0]?.n ?? 0);
  const p = Number((pendingRows as { p: number }[])[0]?.p ?? 0);
  console.log(`Ledger na org: ${n} lançamentos (${p} pending_settlement)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
