/*
 * Corrige mojibake em lote (idempotente) usando UPDATE por id.
 *
 * Os valores corretos foram inferidos a partir do scan-mojibake.js:
 *  - sequencias '├ú' = 'ã'
 *  - '├í' = 'á'
 *  - '├╝' / '├│' = 'ó'
 *  - '├ê' / '├ª' = 'ê'
 *  - '├í' = 'á', '├¡' = 'í', '├▒' = 'ñ'
 *  - 'm??dulos' = 'modulos' / 'módulos'
 *  - 'pap??is' = 'papéis'
 *  - 'permiss??es' = 'permissões'
 *  - 'usu??rio' = 'usuário'
 *  - 'lan??amentos' = 'lançamentos'
 *  - 'cust??dia' = 'custódia'
 *
 * Idempotente: se o valor ja eh o canonico, o UPDATE nao muda nada.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const FIXES = [
  {
    table: 'modules',
    id: 'mod-003',
    column: 'name',
    value: 'Gestão Financeira',
  },
  {
    table: 'roles',
    id: '00000000-0000-4000-8000-000000000003',
    column: 'name',
    value: 'Super usuário da holding',
  },
  {
    table: 'roles',
    id: '00000000-0000-4000-8000-000000000003',
    column: 'description',
    value:
      'Acesso total ao contrato (Cockpit cliente + módulos licenciados). Sem telas/permissões exclusivas da equipe co-CEO.',
  },
  {
    table: 'roles',
    id: '00000000-0000-4000-8000-000000000004',
    column: 'description',
    value: 'Template: opera módulos',
  },
  {
    table: 'permissions',
    id: '00000000-0000-4001-8000-000000000008',
    column: 'description',
    value: 'Emular usuários da subárvore',
  },
  {
    table: 'permissions',
    id: '00000000-0000-4001-8000-000000000013',
    column: 'description',
    value: 'Ver painel de regressão e cobertura',
  },
  {
    table: 'permissions',
    id: '00000000-0000-4001-8000-000000000014',
    column: 'description',
    value: 'Disparar suíte de regressão (ambiente dev)',
  },
  {
    table: 'permissions',
    id: 'd56cacc4-52b6-11f1-a32e-4c77cb9d63f3',
    column: 'description',
    value: 'Emular usuário do cliente',
  },
  {
    table: 'permissions',
    id: 'd56cb9ce-52b6-11f1-a32e-4c77cb9d63f3',
    column: 'description',
    value: 'Ver papéis e permissões',
  },
  {
    table: 'permissions',
    id: 'd56cbb48-52b6-11f1-a32e-4c77cb9d63f3',
    column: 'description',
    value: 'Gerir equipe e papéis do contrato',
  },
  {
    table: 'permissions',
    id: 'd56cc23c-52b6-11f1-a32e-4c77cb9d63f3',
    column: 'description',
    value: 'Ler lançamentos',
  },
  {
    table: 'permissions',
    id: 'd56cc677-52b6-11f1-a32e-4c77cb9d63f3',
    column: 'description',
    value: 'Ver custódia',
  },
];

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const user = process.env.REMOTE_DB_USER || process.env.DB_USER || 'root';
  const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD || '';
  const database = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';

  console.log(`Conectando em ${user}@${host}/${database} (utf8mb4)`);
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    charset: 'utf8mb4',
  });
  await conn.query("SET NAMES 'utf8mb4'");

  let totalUpdated = 0;
  let totalNoOp = 0;
  for (const fix of FIXES) {
    const [res] = await conn.query(
      `UPDATE \`${fix.table}\`
         SET \`${fix.column}\` = ?
       WHERE id = ?
         AND \`${fix.column}\` <> ?`,
      [fix.value, fix.id, fix.value]
    );
    if (res.affectedRows > 0) {
      console.log(`  [${fix.table}.${fix.column}] id=${fix.id} -> '${fix.value}'`);
      totalUpdated += res.affectedRows;
    } else {
      totalNoOp += 1;
    }
  }

  console.log(`\nLinhas corrigidas: ${totalUpdated}`);
  console.log(`Linhas ja canonicas (no-op): ${totalNoOp}`);

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
