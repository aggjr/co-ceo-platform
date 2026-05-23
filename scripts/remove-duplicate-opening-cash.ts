/**
 * Remove saldo inicial de caixa duplicado em 2026-01-01 (manual sem extrato).
 * Mantém: BROKER_REF:BTG-EXTRATO-OPENING-2026-01-01 (comprovação no extrato).
 *
 *   npx ts-node scripts/remove-duplicate-opening-cash.ts
 *   npx ts-node scripts/remove-duplicate-opening-cash.ts --dry-run
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const KEEP_REF = 'BROKER_REF:BTG-EXTRATO-OPENING-2026-01-01';
const OPENING_DATE = '2026-01-01';

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

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT fle.id, fle.direction, fle.amount, fle.description, fle.external_ref, fle.metadata,
            fle.business_event_id
     FROM financial_ledger_entries fle
     WHERE fle.organization_id = ? AND fle.deleted_at IS NULL
       AND fle.transaction_date = ?
       AND fle.direction = 'in'
       AND ABS(fle.amount - 58758.79) < 0.02
     ORDER BY fle.external_ref`,
    [ORG, OPENING_DATE]
  );

  console.log(`Lançamentos caixa ${OPENING_DATE} ~ R$ 58.758,79: ${rows.length}`);
  for (const r of rows) {
    const meta =
      typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : r.metadata || {};
    console.log(
      `  ${r.id} | ref=${r.external_ref || '—'} | legacy=${meta.legacy_op || '—'} | be=${r.business_event_id || '—'} | ${r.description}`
    );
  }

  const toRemove = rows.filter((r) => {
    const ref = String(r.external_ref || '');
    if (ref === KEEP_REF) return false;
    const meta =
      typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : r.metadata || {};
    const brokerRef = String(meta.broker_note_ref || '');
    if (brokerRef === 'BTG-EXTRATO-OPENING-2026-01-01') return false;
    return true;
  });

  if (!toRemove.length) {
    console.log('Nada a remover — só existe o lançamento do extrato (ou nenhum duplicado).');
    await pool.end();
    return;
  }

  if (toRemove.length > 1) {
    console.warn('ATENÇÃO: mais de um candidato a remoção; revise antes de apagar.');
  }

  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  for (const r of toRemove) {
    console.log(`${dryRun ? '[dry-run] removeria' : 'Removendo'}: ${r.id}`);
    if (!dryRun) {
      await gateway.softDelete(ctx, 'financial_ledger_entries', String(r.id));
    }
  }

  const [after] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT fle.id, fle.external_ref, fle.amount
     FROM financial_ledger_entries fle
     WHERE fle.organization_id = ? AND fle.deleted_at IS NULL
       AND fle.transaction_date = ? AND fle.direction = 'in'
       AND ABS(fle.amount - 58758.79) < 0.02`,
    [ORG, OPENING_DATE]
  );
  console.log(`\nApós limpeza: ${after.length} lançamento(s)`);
  for (const r of after) {
    console.log(`  ${r.id} | ${r.external_ref} | R$ ${Number(r.amount).toFixed(2)}`);
  }

  await pool.end();
  console.log(dryRun ? '\nDry-run — nada alterado.' : '\nConcluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
