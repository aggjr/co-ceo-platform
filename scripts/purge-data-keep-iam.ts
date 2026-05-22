/**
 * Purge de dados do co_ceo_platform mantendo:
 *  - Catálogo (modules, roles, permissions, access_resources, role_*)
 *  - org-holding-001
 *  - ctr-holding-001 + contract_modules + contract_users
 *  - 3 usuários: admin@coceo.com.br, augustoggomes@yahoo.com.br, analista@holding.demo
 *  - user_roles dos 3 usuários
 *
 * Apaga:
 *  - Todo invest_*
 *  - audit_logs, iam_config_audit
 *  - telemetry_events, database_usage_telemetry, organization_storage_ledger
 *  - quality_test_runs
 *  - field_permissions, custom_field_labels
 *  - usuário admin@co-ceo.com (usr-co-ceo-001) — após reapontar FK do contrato
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const SUPER_ADMIN_ID = 'a4052508-d505-42d0-8589-178157983e9c';
const USER_TO_REMOVE = 'usr-co-ceo-001';

const TRUNCATE_TABLES = [
  'invest_ledger_entries',
  'invest_daily_snapshots',
  'invest_portfolio_daily',
  'invest_options_chain',
  'invest_assets',
  'audit_logs',
  'iam_config_audit',
  'telemetry_events',
  'database_usage_telemetry',
  'organization_storage_ledger',
  'quality_test_runs',
  'field_permissions',
  'custom_field_labels',
];

(async () => {
  const password = process.env.REMOTE_DB_PASSWORD;
  if (!password) {
    console.error('Set REMOTE_DB_PASSWORD');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: 'root',
    password,
    database: 'co_ceo_platform',
    multipleStatements: false,
  });

  console.log('PASSO 1 — reapontar contract.co_ceo_manager_user_id para super admin');
  const [u1] = await conn.query<mysql.ResultSetHeader>(
    `UPDATE contracts SET co_ceo_manager_user_id = ? WHERE co_ceo_manager_user_id = ?`,
    [SUPER_ADMIN_ID, USER_TO_REMOVE]
  );
  console.log(`  rows: ${u1.affectedRows}`);

  console.log('PASSO 2 — TRUNCATE tabelas de operação/telemetria/auditoria');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TRUNCATE_TABLES) {
    try {
      const [r] = await conn.query<mysql.ResultSetHeader>(`TRUNCATE TABLE \`${t}\``);
      console.log(`  ${t.padEnd(34)} ok`);
    } catch (e) {
      console.log(`  ${t.padEnd(34)} ERR ${(e as Error).message}`);
    }
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log('PASSO 3 — remover user_roles do usuário descontinuado');
  const [u3] = await conn.query<mysql.ResultSetHeader>(
    `DELETE FROM user_roles WHERE user_id = ?`,
    [USER_TO_REMOVE]
  );
  console.log(`  rows: ${u3.affectedRows}`);

  console.log('PASSO 4 — remover contract_users do usuário descontinuado (se houver)');
  const [u4] = await conn.query<mysql.ResultSetHeader>(
    `DELETE FROM contract_users WHERE user_id = ?`,
    [USER_TO_REMOVE]
  );
  console.log(`  rows: ${u4.affectedRows}`);

  console.log('PASSO 5 — DELETE user usr-co-ceo-001');
  const [u5] = await conn.query<mysql.ResultSetHeader>(`DELETE FROM users WHERE id = ?`, [USER_TO_REMOVE]);
  console.log(`  rows: ${u5.affectedRows}`);

  console.log('\nESTADO FINAL ============================');
  const tables = [
    'users',
    'organizations',
    'contracts',
    'contract_modules',
    'contract_users',
    'user_roles',
    'roles',
    'permissions',
    'access_resources',
    'invest_assets',
    'invest_ledger_entries',
    'invest_daily_snapshots',
    'invest_portfolio_daily',
    'audit_logs',
    'iam_config_audit',
    'telemetry_events',
    'database_usage_telemetry',
    'organization_storage_ledger',
  ];
  for (const t of tables) {
    const [r] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) c FROM \`${t}\``);
    console.log(`  ${t.padEnd(34)} ${r[0]!.c}`);
  }

  await conn.end();
  console.log('\nPURGE concluído.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
