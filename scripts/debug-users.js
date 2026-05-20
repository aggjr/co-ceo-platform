const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  try {
    console.log('--- USERS ---');
    const [users] = await pool.query('SELECT id, email, full_name, is_active FROM users');
    console.table(users);

    console.log('--- CONTRACTS ---');
    const [contracts] = await pool.query('SELECT id, organization_id, status FROM contracts');
    console.table(contracts);

    console.log('--- ORGANIZATIONS ---');
    const [orgs] = await pool.query('SELECT id, parent_id, name, type, path FROM organizations');
    console.table(orgs);

    console.log('--- USER ROLES ---');
    const [userRoles] = await pool.query(
      `SELECT ur.id, ur.user_id, u.email, ur.role_id, r.name as role_name, ur.contract_id, ur.organization_id, ur.is_primary 
       FROM user_roles ur
       LEFT JOIN users u ON u.id = ur.user_id
       LEFT JOIN roles r ON r.id = ur.role_id`
    );
    console.table(userRoles);

    console.log('--- PERMISSIONS FOR ROLE_IDS IN USER_ROLES ---');
    const [rolePerms] = await pool.query(
      `SELECT rp.role_id, r.name as role_name, p.code as permission_code
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id`
    );
    console.table(rolePerms);
  } catch (error) {
    console.error(error);
  } finally {
    await pool.end();
  }
}

main();
