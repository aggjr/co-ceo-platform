import 'dotenv/config';
import mysql from 'mysql2/promise';

(async () => {
  const host = process.env.REMOTE_DB_HOST || '69.62.99.34';
  const password = process.env.REMOTE_DB_PASSWORD;
  if (!password) {
    console.error('Set REMOTE_DB_PASSWORD');
    process.exit(1);
  }
  const conn = await mysql.createConnection({ host, user: 'root', password, database: 'co_ceo_platform' });

  console.log('\n=== USERS (ativos, sem soft-delete) ===');
  const [users] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, email, full_name, preferred_name, is_active, deleted_at
     FROM users ORDER BY created_at ASC`
  );
  for (const u of users) {
    console.log(`  ${u.id}  ${String(u.email).padEnd(36)} | ${u.full_name}${u.deleted_at ? '  [DELETADO]' : ''}${u.is_active ? '' : '  [INATIVO]'}`);
  }

  console.log('\n=== ORGANIZATIONS ===');
  const [orgs] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, name, type, parent_id, status, deleted_at FROM organizations ORDER BY path`
  );
  for (const o of orgs) {
    console.log(`  ${o.id}  ${String(o.name).padEnd(42)} ${o.type.padEnd(14)} parent=${o.parent_id ?? '—'}${o.deleted_at ? '  [DELETADO]' : ''}`);
  }

  console.log('\n=== CONTRACTS ===');
  const [contracts] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT c.id, c.organization_id, o.name org_name, c.client_manager_user_id, c.co_ceo_manager_user_id, c.status
     FROM contracts c LEFT JOIN organizations o ON o.id = c.organization_id`
  );
  for (const c of contracts) {
    console.log(`  ${c.id}  org=${c.org_name}  client_mgr=${c.client_manager_user_id}  coceo_mgr=${c.co_ceo_manager_user_id}  ${c.status}`);
  }

  console.log('\n=== CONTRACT_USERS ===');
  const [cu] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT cu.contract_id, cu.user_id, u.email, cu.default_organization_id, cu.status
     FROM contract_users cu JOIN users u ON u.id = cu.user_id`
  );
  for (const r of cu) {
    console.log(`  ${r.contract_id}  ${r.user_id}  ${String(r.email).padEnd(36)} default_org=${r.default_organization_id}  ${r.status}`);
  }

  console.log('\n=== USER_ROLES (não-deletados) ===');
  const [ur] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ur.user_id, u.email, r.code role_code, ur.organization_id, ur.contract_id, ur.is_primary
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.deleted_at IS NULL`
  );
  for (const r of ur) {
    console.log(`  ${String(r.email).padEnd(36)} role=${String(r.role_code).padEnd(28)} org=${r.organization_id ?? '—'}  contract=${r.contract_id ?? '—'}  ${r.is_primary ? 'PRIMARY' : ''}`);
  }

  console.log('\n=== ROLES (resumo) ===');
  const [roles] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, code, scope, is_system FROM roles WHERE deleted_at IS NULL ORDER BY scope, code`
  );
  for (const r of roles) {
    console.log(`  ${r.id}  ${String(r.code).padEnd(34)} ${String(r.scope).padEnd(10)} ${r.is_system ? 'SYSTEM' : ''}`);
  }

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
