import type { Pool } from 'mysql2/promise';
import { runSqlFile, tableExists } from './sqlMigrationRunner';
import { ensureInvestReconciliationSchema } from './ensureInvestReconciliationSchema';

const MARKET_TABLES = ['market_instruments', 'market_quotes_daily', 'market_index_daily'] as const;

export type EnsureCoreSchemaResult = {
  marketMigrationApplied: boolean;
  platformJobMigrationApplied: boolean;
  reconciliationMigrationApplied: boolean;
};

/**
 * Garante tabelas globais exigidas pela API atual (mercado + monitor de jobs).
 * Idempotente: só aplica o .sql quando a tabela âncora não existe.
 */
export async function ensureCoreSchema(pool: Pool): Promise<EnsureCoreSchemaResult> {
  let marketMigrationApplied = false;
  let platformJobMigrationApplied = false;

  for (const t of MARKET_TABLES) {
    if (!(await tableExists(pool, t))) {
      await runSqlFile(pool, '22_market_quotes_global.sql');
      marketMigrationApplied = true;
      break;
    }
  }

  if (!(await tableExists(pool, 'platform_scheduled_job_runs'))) {
    await runSqlFile(pool, '25_platform_job_monitoring.sql');
    platformJobMigrationApplied = true;
  }

  const reconciliation = await ensureInvestReconciliationSchema(pool);

  return {
    marketMigrationApplied,
    platformJobMigrationApplied,
    reconciliationMigrationApplied: reconciliation.applied,
  };
}
