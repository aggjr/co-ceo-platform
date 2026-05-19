require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [result] = await c.query(
    `UPDATE user_roles ur
     INNER JOIN contract_users cu ON cu.user_id = ur.user_id AND cu.contract_id = ur.contract_id
     SET ur.organization_id = cu.default_organization_id
     WHERE ur.contract_id = 'ctr-holding-001'
       AND ur.organization_id IS NULL
       AND cu.default_organization_id IS NOT NULL`
  );
  console.log('user_roles corrigidos:', result.affectedRows);
  await c.end();
})();
