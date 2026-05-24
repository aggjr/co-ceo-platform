/**
 * Popula ui_text_catalog + ui_menu_nodes via MySQL direto (sem gateway/auditoria).
 * Uso: npx ts-node scripts/seed-ui-catalog-raw.ts [--remote]
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { LOCALE, MENU, TEXTS } from '../src/database/seeds/008_ui_catalog';

dotenv.config();

const remote = process.argv.includes('--remote');

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

  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    charset: 'utf8mb4',
  });

  console.log(`[seed-ui-raw] ${remote ? 'REMOTO' : 'LOCAL'} ${host}/${database}`);

  let texts = 0;
  for (const t of TEXTS) {
    await conn.query(
      `INSERT INTO ui_text_catalog (id, text_key, locale, module_code, kind, default_text, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         default_text = VALUES(default_text),
         module_code = VALUES(module_code),
         kind = VALUES(kind),
         description = COALESCE(VALUES(description), description),
         metadata = COALESCE(VALUES(metadata), metadata)`,
      [
        t.id,
        t.text_key,
        LOCALE,
        t.module_code,
        t.kind,
        t.default_text,
        t.description ?? null,
        t.metadata ? JSON.stringify(t.metadata) : null,
      ]
    );
    texts += 1;
  }

  const codeToId = new Map<string, string>();
  for (const m of MENU) codeToId.set(m.code, m.id);

  let menu = 0;
  for (const m of MENU) {
    const parentId = m.parent_code ? codeToId.get(m.parent_code) ?? null : null;
    await conn.query(
      `INSERT INTO ui_menu_nodes (
         id, code, parent_id, module_code, path, icon, order_index,
         text_key, access_resource_key, visibility, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         parent_id = VALUES(parent_id),
         module_code = VALUES(module_code),
         path = VALUES(path),
         icon = VALUES(icon),
         order_index = VALUES(order_index),
         text_key = VALUES(text_key),
         access_resource_key = VALUES(access_resource_key),
         visibility = VALUES(visibility),
         is_active = TRUE`,
      [
        m.id,
        m.code,
        parentId,
        m.module_code,
        m.path,
        m.icon,
        m.order_index,
        m.text_key,
        m.access_resource_key,
        m.visibility,
      ]
    );
    menu += 1;
  }

  await conn.end();
  console.log(`[seed-ui-raw] OK textos=${texts} menu=${menu}`);
}

main().catch((err) => {
  console.error('[seed-ui-raw] Falha:', err.message || err);
  process.exit(1);
});
