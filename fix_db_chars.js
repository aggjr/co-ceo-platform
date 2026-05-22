const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixDb() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'co_ceo_platform',
    multipleStatements: true
  });

  try {
    console.log('Fixing corrupted strings in the database...');
    
    const queries = [
      `UPDATE roles SET name = 'Super usuário da holding' WHERE name LIKE '%usu%rio da holding%';`,
      `UPDATE roles SET description = 'Acesso total ao contrato (Cockpit cliente + módulos licenciados). Sem telas/permissões exclusivas da equipe co-CEO.' WHERE code = 'ORG_OWNER';`,
      `UPDATE permissions SET description = 'Emular usuário do cliente' WHERE code = 'core:impersonate:execute';`,
      `UPDATE permissions SET description = 'Ver papéis e permissões' WHERE code = 'cockpit:iam:read';`,
      `UPDATE permissions SET description = 'Ver custódia' WHERE code = 'invest:custody:read';`,
      `UPDATE permissions SET description = 'Ler lançamentos' WHERE code = 'invest:ledger:read';`,
      `UPDATE permissions SET description = 'Gerir equipe e papéis do contrato' WHERE code = 'cockpit:iam:manage_team';`,
      `UPDATE organizations SET name = 'Holding Financeira Gonçalves' WHERE name LIKE '%Financeira Gon%alves%';`
    ];

    for (const q of queries) {
      const [res] = await connection.query(q);
      console.log('Executed:', q, 'Rows affected:', res.affectedRows);
    }

    console.log('Database fixed successfully!');
  } catch (error) {
    console.error('Error fixing database:', error);
  } finally {
    await connection.end();
  }
}

fixDb();
