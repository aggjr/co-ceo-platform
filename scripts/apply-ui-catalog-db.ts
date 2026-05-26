/**
 * Aplica schema UI (se faltar), seed raw, swap de rotas do menu e textos pt-BR.
 * Uso: npx ts-node scripts/apply-ui-catalog-db.ts [--remote]
 */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

dotenv.config();

const remote = process.argv.includes('--remote');

async function tableExists(conn: mysql.Connection, name: string) {
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLES LIKE ?', [name]);
  return Array.isArray(rows) && rows.length > 0;
}

async function runSqlFile(conn: mysql.Connection, relPath: string) {
  const full = path.join(__dirname, '..', relPath);
  const sql = fs.readFileSync(full, 'utf8');
  await conn.query(sql);
  console.log(`OK: ${relPath}`);
}

async function main() {
  const host = remote
    ? process.env.REMOTE_DB_HOST || '69.62.99.34'
    : process.env.DB_HOST || '127.0.0.1';
  const user = remote
    ? process.env.REMOTE_DB_USER || process.env.DB_USER || 'root'
    : process.env.DB_USER || 'root';
  const password = remote
    ? process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD
    : process.env.DB_PASSWORD;
  const database =
    process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';

  if (!password) {
    console.error('Defina DB_PASSWORD (ou REMOTE_DB_PASSWORD).');
    process.exit(1);
  }

  console.log(`[db:ui] ${remote ? 'REMOTO' : 'LOCAL'} ${host}/${database}`);

  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  if (!(await tableExists(conn, 'ui_text_catalog'))) {
    await runSqlFile(conn, 'src/database/migrations/20_ui_catalog_schema.sql');
    try {
      await runSqlFile(conn, 'src/database/migrations/21_ui_text_metadata.sql');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Duplicate column/i.test(msg)) throw e;
    }
  }

  await conn.end();

  const rawFlag = remote ? '--remote' : '';
  execSync(`npx ts-node scripts/seed-ui-catalog-raw.ts ${rawFlag}`.trim(), {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  const conn2 = await mysql.createConnection({
    host,
    user,
    password,
    database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    await runSqlFile(
      conn2,
      'src/database/migrations/22_ui_invest_menu_swap_portfolio_options_paths.sql'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[db:ui] migration 22:', msg);
  }

  await runSqlFile(conn2, 'src/database/migrations/24_ui_menu_text_pt_br.sql');
  await runSqlFile(conn2, 'src/database/migrations/27_ui_invest_period_labels.sql');
  await runSqlFile(conn2, 'src/database/migrations/29_ui_invest_options_cards_depara.sql');
  await runSqlFile(conn2, 'src/database/migrations/30_ui_catalog_apply_button_labels.sql');
  await runSqlFile(conn2, 'src/database/migrations/31_ui_invest_options_exposure.sql');

  const keys = [
    'menu.invest.portfolio',
    'field.invest.options.strike',
    'field.invest.options.underlying',
    'filter.invest.options.expiry',
  ];
  const [sample] = await conn2.query<mysql.RowDataPacket[]>(
    'SELECT text_key, default_text FROM ui_text_catalog WHERE text_key IN (?) AND locale = ?',
    [keys, 'pt-BR']
  );
  console.log('[db:ui] Amostra:');
  for (const r of sample) {
    console.log(`  ${r.text_key}: ${r.default_text}`);
  }

  await conn2.end();
  console.log('[db:ui] Concluido.');
}

main().catch((err) => {
  console.error('[db:ui] Falha:', err instanceof Error ? err.message : err);
  process.exit(1);
});
