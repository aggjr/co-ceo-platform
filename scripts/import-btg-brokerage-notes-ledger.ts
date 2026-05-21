/**
 * Importa notas BTG 2026 (JSON de conferência) para invest_ledger_entries.
 *
 * Uso:
 *   npx ts-node scripts/import-btg-brokerage-notes-ledger.ts
 *   npx ts-node scripts/import-btg-brokerage-notes-ledger.ts data/invest/btg-brokerage-notes-review-2026.json
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import {
  dedupeBrokerageNotes,
  type BtgBrokerageNote,
} from '../src/core/invest/btgBrokerageNoteParser';
import { brokerageNotesToLedgerLines } from '../src/core/invest/btgBrokerageNoteLedgerTranslator';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const DEFAULT_JSON = path.join(
  __dirname,
  '..',
  'data',
  'invest',
  'btg-brokerage-notes-review-2026.json'
);

async function main() {
  const jsonPath = process.argv[2] || DEFAULT_JSON;
  if (!fs.existsSync(jsonPath)) {
    console.error('Arquivo não encontrado:', jsonPath);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    notes?: BtgBrokerageNote[];
  };
  const rawNotes = payload.notes || [];
  const { kept } = dedupeBrokerageNotes(rawNotes);
  const entries = brokerageNotesToLedgerLines(kept);

  console.log(`Notas: ${kept.length} · Lançamentos gerados: ${entries.length}`);

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'Notas BTG 2026 (conferência)',
  });

  console.log('Import:', JSON.stringify(result, null, 2));

  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const prices = computeThreePricesByUnderlying(events);
  console.log('\nPM triplo (ações com qty > 0):');
  for (const [u, p] of [...prices.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (p.qty <= 0) continue;
    console.log(
      `  ${u}: qty=${p.qty} Estrito=${p.estrito} B3=${p.b3} Ger=${p.gerencial}`
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
