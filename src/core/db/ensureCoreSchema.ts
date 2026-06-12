import type { Pool } from 'mysql2/promise';
import { runSqlFile, tableExists } from './sqlMigrationRunner';
import { ensureInvestReconciliationSchema } from './ensureInvestReconciliationSchema';

const MARKET_TABLES = ['market_instruments', 'market_quotes_daily', 'market_index_daily'] as const;
const SETTLEMENT_CONTRACT_RULES_TABLE = 'settlement_contract_rules';
const INVEST_OPERATION_POLICIES_TABLE = 'invest_operation_policies';
const INVEST_CASH_ACCOUNT_POLICIES_TABLE = 'invest_cash_account_policies';
const INVEST_BOOK_PERIODS_TABLE = 'invest_book_periods';
const INVEST_RECONCILE_RUNS_TABLE = 'invest_reconcile_runs';
const INVEST_POSITION_DAILY_TABLE = 'invest_position_daily';

export type EnsureCoreSchemaResult = {
  marketMigrationApplied: boolean;
  platformJobMigrationApplied: boolean;
  reconciliationMigrationApplied: boolean;
  settlementRulesMigrationApplied: boolean;
  investOperationPolicyMigrationApplied: boolean;
  investCashAccountPolicyMigrationApplied: boolean;
  investBookPeriodsMigrationApplied: boolean;
  investReconcileRunsMigrationApplied: boolean;
  investPositionDailyMigrationApplied: boolean;
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

  let settlementRulesMigrationApplied = false;
  if (!(await tableExists(pool, SETTLEMENT_CONTRACT_RULES_TABLE))) {
    await runSqlFile(pool, '39_normalize_settlement_contracts.sql');
    settlementRulesMigrationApplied = true;
  }

  let investOperationPolicyMigrationApplied = false;
  if (!(await tableExists(pool, INVEST_OPERATION_POLICIES_TABLE))) {
    await runSqlFile(pool, '43_invest_operation_policy_catalog.sql');
    investOperationPolicyMigrationApplied = true;
  }
  // Idempotente: adiciona extract_divergence caso ainda nao exista no catalogo.
  await runSqlFile(pool, '49_extract_divergence_operation.sql');

  let investCashAccountPolicyMigrationApplied = false;
  if (!(await tableExists(pool, INVEST_CASH_ACCOUNT_POLICIES_TABLE))) {
    await runSqlFile(pool, '44_invest_cash_account_policy.sql');
    investCashAccountPolicyMigrationApplied = true;
  } else {
    await runSqlFile(pool, '44_invest_cash_account_policy.sql');
  }

  if (!(await tableExists(pool, 'invest_broker_aliases'))) {
    await runSqlFile(pool, '45_invest_broker_aliases.sql');
  }

  let investBookPeriodsMigrationApplied = false;
  if (!(await tableExists(pool, INVEST_BOOK_PERIODS_TABLE))) {
    await runSqlFile(pool, '46_invest_book_periods.sql');
    investBookPeriodsMigrationApplied = true;
  }

  let investReconcileRunsMigrationApplied = false;
  if (!(await tableExists(pool, INVEST_RECONCILE_RUNS_TABLE))) {
    await runSqlFile(pool, '47_invest_reconcile_runs.sql');
    investReconcileRunsMigrationApplied = true;
  }

  let investPositionDailyMigrationApplied = false;
  if (!(await tableExists(pool, INVEST_POSITION_DAILY_TABLE))) {
    await runSqlFile(pool, '50_invest_position_daily.sql');
    investPositionDailyMigrationApplied = true;
  }

  return {
    marketMigrationApplied,
    platformJobMigrationApplied,
    reconciliationMigrationApplied: reconciliation.applied,
    settlementRulesMigrationApplied,
    investOperationPolicyMigrationApplied,
    investCashAccountPolicyMigrationApplied,
    investBookPeriodsMigrationApplied,
    investReconcileRunsMigrationApplied,
    investPositionDailyMigrationApplied,
  };
}
