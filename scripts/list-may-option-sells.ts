import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: 'org-holding-001', scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const ev = await ledger.listLedgerEvents(ctx, '2026-05-18', '2026-05-22');

  const note = ev.filter((e) => String(e.broker_note_ref || '').includes('32045229'));
  console.log('=== Nota 32045229 (19/05) ===', note.length, 'pernas');
  for (const e of note) {
    console.log(`  ${e.asset_ticker} ${e.transaction_type} qty=${e.quantity} @ ${e.unit_price}`);
  }

  const sellTypes = new Set(['call_sell', 'put_sell', 'sell']);
  const maySell = ev.filter((e) => sellTypes.has(String(e.transaction_type)));
  console.log('\n=== Vendas opção 18–22/05 por nota ===');
  const byRef = new Map<string, typeof maySell>();
  for (const e of maySell) {
    const r = String(e.broker_note_ref || '?');
    if (!byRef.has(r)) byRef.set(r, []);
    byRef.get(r)!.push(e);
  }
  for (const [r, arr] of [...byRef.entries()].sort()) {
    console.log(
      r,
      arr.map((a) => `${a.asset_ticker}(${a.quantity})`).join(', ')
    );
  }

  await pool.end();
}

main().catch(console.error);
