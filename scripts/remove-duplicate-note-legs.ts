/**
 * Remove pernas duplicadas de nota (mesmo fingerprint, refs BTG-NOTA-…#N e #N+1).
 * Mantém a menor linha (#); apaga patrimônio + caixa vinculados ao ref maior.
 *
 *   npx ts-node scripts/remove-duplicate-note-legs.ts --dry-run
 *   npx ts-node scripts/remove-duplicate-note-legs.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { fingerprintFromLedgerEvent } from '../src/core/invest/ledgerOperationDedup';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function isTrade(e: LedgerEvent): boolean {
  if (e.asset_type === 'cash') return false;
  const op = String(e.transaction_type);
  return !['fee', 'opening_balance', 'dividend', 'jcp'].includes(op);
}

function lineIndexFromRef(ref: string | null | undefined): number {
  const m = String(ref || '').match(/#(\d+)$/);
  return m ? Number(m[1]) : 0;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const trades = events.filter(isTrade);

  const byFp = new Map<string, LedgerEvent[]>();
  for (const e of trades) {
    const fp = fingerprintFromLedgerEvent(e);
    const list = byFp.get(fp) || [];
    list.push(e);
    byFp.set(fp, list);
  }

  const refsToRemove = new Set<string>();
  for (const [fp, group] of byFp) {
    if (group.length < 2) continue;
    const refs = [...new Set(group.map((e) => String(e.broker_note_ref || '')))].filter(Boolean);
    if (refs.length < 2) continue;
    const sorted = refs.sort((a, b) => lineIndexFromRef(a) - lineIndexFromRef(b));
    const keep = sorted[0]!;
    for (const r of sorted.slice(1)) {
      refsToRemove.add(r);
      console.log(`Fingerprint ${fp}: manter ${keep}, remover ${r}`);
    }
  }

  if (!refsToRemove.size) {
    console.log('Nenhuma duplicata de nota para remover.');
    await pool.end();
    return;
  }

  const patrimonyIds: string[] = [];
  const financialIds: string[] = [];

  for (const e of events) {
    const ref = String(e.broker_note_ref || '');
    if (!refsToRemove.has(ref)) continue;
    if (e.asset_type === 'cash') {
      if (e.id) financialIds.push(String(e.id));
    } else if (e.id) {
      patrimonyIds.push(String(e.id));
    }
  }

  console.log(`\nPatrimônio: ${patrimonyIds.length} | Caixa: ${financialIds.length}`);

  for (const id of patrimonyIds) {
    console.log(`${dryRun ? '[dry-run]' : 'Removendo'} patrimony ${id}`);
    if (!dryRun) await gateway.softDelete(ctx, 'patrimony_ledger_entries', id);
  }
  for (const id of financialIds) {
    console.log(`${dryRun ? '[dry-run]' : 'Removendo'} financial ${id}`);
    if (!dryRun) await gateway.softDelete(ctx, 'financial_ledger_entries', id);
  }

  await pool.end();
  console.log(dryRun ? '\nDry-run — nada alterado.' : '\nConcluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
