/*
 * Reset seletivo das tabelas INVEST escopadas em uma organizacao.
 *
 * Apaga FISICAMENTE (hard delete) todas as pernas, headers, items, accounts
 * e tabelas auxiliares do INVEST para a `org-holding-001` (ou ORG_ID via env).
 *
 * NAO toca:
 *   - users, roles, permissions, organizations, contracts (IAM/catalog)
 *   - quality_test_runs, audit_logs (auditoria/telemetria)
 *
 * Uso (PowerShell):
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   $env:REMOTE_DB_HOST = "69.62.99.34"
 *   node scripts/reset-invest-tables.js --confirm
 *
 * Sem --confirm, apenas mostra o que SERIA apagado (dry-run).
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const CONFIRM = process.argv.includes('--confirm');

// Ordem importa: filhos antes dos pais. DELETE físico (inclui linhas soft-deleted).
const DELETE_PLAN = [
  { table: 'patrimony_ledger_entries', scoped: true },
  { table: 'financial_ledger_entries', scoped: true },
  { table: 'patrimony_closings', scoped: true },
  { table: 'financial_closings', scoped: true },
  { table: 'invest_option_ext', scoped: true },
  { table: 'invest_position_ext', scoped: true },
  { table: 'patrimony_item_locations', scoped: true },
  { table: 'business_events', scoped: true },
  { table: 'patrimony_items', scoped: true },
  { table: 'patrimony_locations', scoped: true },
  { table: 'financial_accounts', scoped: true },
  // Snapshots/diarios (re-buildaveis)
  { table: 'invest_daily_snapshots', scoped: true },
  { table: 'invest_portfolio_daily', scoped: true },
  { table: 'invest_broker_custody_snapshot_lines', scoped: true },
  { table: 'invest_broker_custody_snapshots', scoped: true },
  { table: 'invest_patrimony_monthly_anchors', scoped: true },
  { table: 'invest_assets', scoped: true },
  { table: 'invest_ledger_entries', scoped: true },
];

async function main() {
  const host = process.env.REMOTE_DB_HOST || '69.62.99.34';
  const conn = await mysql.createConnection({
    host,
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  console.log(
    `\nReset INVEST em org=${ORG_ID} @ ${host} ${CONFIRM ? '(DELETE FÍSICO)' : '(DRY-RUN)'}`
  );
  console.log('Modo: DELETE FROM (hard delete) — não usa soft_delete.');

  console.log('\n--- ANTES ---');
  const before = {};
  for (const { table, scoped } of DELETE_PLAN) {
    const where = scoped ? 'WHERE organization_id = ?' : '';
    const params = scoped ? [ORG_ID] : [];
    try {
      const [r] = await conn.query(`SELECT COUNT(*) c FROM \`${table}\` ${where}`, params);
      before[table] = r[0].c;
      console.log(`  ${table.padEnd(30)} ${String(r[0].c).padStart(6)}`);
    } catch (err) {
      console.log(`  ${table.padEnd(30)} ERR ${err.message}`);
      before[table] = null;
    }
  }

  if (!CONFIRM) {
    console.log('\nDRY-RUN: nada foi apagado. Adicione --confirm para executar.');
    await conn.end();
    return;
  }

  console.log('\n--- EXECUTANDO DELETE ---');
  await conn.beginTransaction();
  try {
    // Desliga FK durante o reset para nao depender da ordem exata
    // (algumas FKs sao ON DELETE RESTRICT).
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const { table, scoped } of DELETE_PLAN) {
      if (before[table] === null) continue;
      const where = scoped ? 'WHERE organization_id = ?' : '';
      const params = scoped ? [ORG_ID] : [];
      const [res] = await conn.query(`DELETE FROM \`${table}\` ${where}`, params);
      console.log(`  ${table.padEnd(30)} apagadas: ${res.affectedRows}`);
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
  } catch (err) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.rollback();
    throw err;
  }

  console.log('\n--- DEPOIS ---');
  for (const { table, scoped } of DELETE_PLAN) {
    const where = scoped ? 'WHERE organization_id = ?' : '';
    const params = scoped ? [ORG_ID] : [];
    try {
      const [r] = await conn.query(`SELECT COUNT(*) c FROM \`${table}\` ${where}`, params);
      console.log(`  ${table.padEnd(30)} ${String(r[0].c).padStart(6)}`);
    } catch (err) {
      console.log(`  ${table.padEnd(30)} ERR ${err.message}`);
    }
  }

  await conn.end();
  console.log('\nReset concluido. Proximos passos: opening -> notas BTG -> extrato BTG.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
