import fs from 'fs';
import path from 'path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { LOCALE, MENU, TEXTS } from '../../database/seeds/008_ui_catalog';

export type UiCatalogApplyResult = {
  schemaCreated: boolean;
  textsUpserted: number;
  menuUpserted: number;
  menuPathsFixed: boolean;
  labelsPtBrFixed: boolean;
  sample: Array<{ text_key: string; default_text: string }>;
};

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [name]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

function migrationsDir(): string {
  return path.join(process.cwd(), 'src', 'database', 'migrations');
}

async function runSqlFile(pool: Pool, fileName: string): Promise<void> {
  const full = path.join(migrationsDir(), fileName);
  const sql = fs.readFileSync(full, 'utf8');
  await pool.query(sql);
}

export async function applyUiCatalog(pool: Pool): Promise<UiCatalogApplyResult> {
  let schemaCreated = false;

  if (!(await tableExists(pool, 'ui_text_catalog'))) {
    await runSqlFile(pool, '20_ui_catalog_schema.sql');
    try {
      await runSqlFile(pool, '21_ui_text_metadata.sql');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Duplicate column/i.test(msg)) throw e;
    }
    schemaCreated = true;
  }

  for (const t of TEXTS) {
    await pool.query(
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
  }

  const codeToId = new Map<string, string>();
  for (const m of MENU) codeToId.set(m.code, m.id);

  for (const m of MENU) {
    const parentId = m.parent_code ? codeToId.get(m.parent_code) ?? null : null;
    await pool.query(
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
  }

  await runSqlFile(pool, '22_ui_invest_menu_swap_portfolio_options_paths.sql');
  await runSqlFile(pool, '24_ui_menu_text_pt_br.sql');

  const keys = [
    'menu.invest.portfolio',
    'menu.invest.dashboard',
    'menu.invest.historico_operacoes',
  ];
  const [sample] = await pool.query<RowDataPacket[]>(
    'SELECT text_key, default_text FROM ui_text_catalog WHERE text_key IN (?) AND locale = ?',
    [keys, LOCALE]
  );

  return {
    schemaCreated,
    textsUpserted: TEXTS.length,
    menuUpserted: MENU.length,
    menuPathsFixed: true,
    labelsPtBrFixed: true,
    sample: sample.map((r) => ({
      text_key: String(r.text_key),
      default_text: String(r.default_text),
    })),
  };
}
