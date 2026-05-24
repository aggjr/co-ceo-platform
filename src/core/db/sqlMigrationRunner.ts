import fs from 'fs';
import path from 'path';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export function migrationsDir(): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'database', 'migrations'),
    path.join(__dirname, '../../database/migrations'),
    path.join(__dirname, '../../../src/database/migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

export async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [name]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

function isBenignSqlError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|Duplicate column/i.test(msg);
}

/** Executa um arquivo .sql statement a statement (sem multipleStatements no pool). */
export async function runSqlFile(pool: Pool, fileName: string): Promise<void> {
  const full = path.join(migrationsDir(), fileName);
  const sql = fs.readFileSync(full, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      if (!isBenignSqlError(err)) throw err;
    }
  }
}
