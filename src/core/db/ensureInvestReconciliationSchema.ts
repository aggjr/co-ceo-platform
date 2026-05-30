import type { Pool } from 'mysql2/promise';
import { runSqlFile, tableExists } from './sqlMigrationRunner';

const SESSIONS_TABLE = 'invest_reconciliation_sessions';
const DAY_LOG_TABLE = 'invest_reconciliation_day_log';
const MIGRATION_FILE = '34_invest_reconciliation_sessions.sql';

export type EnsureInvestReconciliationSchemaResult = {
  applied: boolean;
  migrationFile: string;
};

/**
 * Garante tabelas da sessão de conciliação (Opção C / modo preciso).
 * Idempotente — aplica migration 34 só se alguma tabela não existir.
 */
export async function ensureInvestReconciliationSchema(
  pool: Pool
): Promise<EnsureInvestReconciliationSchemaResult> {
  const hasSessions = await tableExists(pool, SESSIONS_TABLE);
  const hasDayLog = await tableExists(pool, DAY_LOG_TABLE);
  if (hasSessions && hasDayLog) {
    return { applied: false, migrationFile: MIGRATION_FILE };
  }

  await runSqlFile(pool, MIGRATION_FILE);

  if (!(await tableExists(pool, SESSIONS_TABLE))) {
    throw new Error(
      `Falha ao criar ${SESSIONS_TABLE} — verifique migration ${MIGRATION_FILE}.`
    );
  }

  return { applied: true, migrationFile: MIGRATION_FILE };
}
