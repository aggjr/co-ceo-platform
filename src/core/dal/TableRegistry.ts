import { GatewayError } from './errors';
import type { PayloadValue } from './types';

export type TableKind = 'global' | 'tenant' | 'system' | 'telemetry';

export interface TableDefinition {
  name: string;
  kind: TableKind;
  softDelete: boolean;
  primaryKey: string;
  /** PK composta (vínculos IAM). Se omitido, usa [primaryKey]. */
  primaryKeyColumns?: string[];
  /** DELETE físico permitido (somente installer, tabelas de vínculo). */
  allowHardDelete?: boolean;
  /** Colunas que nunca podem ser escritas pelo cliente (injeção automática) */
  blockedWritableColumns: Set<string>;
  countsTowardStorage: boolean;
}

const DEFAULT_BLOCKED = new Set(['organization_id', 'created_at', 'updated_at', 'deleted_at']);

function def(
  name: string,
  kind: TableKind,
  opts: Partial<Omit<TableDefinition, 'name' | 'kind'>> = {}
): TableDefinition {
  return {
    name,
    kind,
    softDelete: opts.softDelete ?? kind === 'tenant',
    primaryKey: opts.primaryKey ?? 'id',
    primaryKeyColumns: opts.primaryKeyColumns,
    allowHardDelete: opts.allowHardDelete,
    blockedWritableColumns: opts.blockedWritableColumns ?? new Set(DEFAULT_BLOCKED),
    countsTowardStorage: opts.countsTowardStorage ?? kind === 'tenant',
  };
}

const TABLES: TableDefinition[] = [
  def('organizations', 'global', { softDelete: true, countsTowardStorage: false }),
  def('users', 'global', { softDelete: true, countsTowardStorage: false }),
  def('modules', 'global', { softDelete: false, countsTowardStorage: false }),
  def('contracts', 'tenant', { softDelete: true }),
  def('contract_modules', 'global', {
    softDelete: false,
    primaryKey: 'contract_id',
    countsTowardStorage: false,
  }),
  def('contract_users', 'global', { softDelete: false, primaryKey: 'contract_id' }),
  def('roles', 'global', { softDelete: true, countsTowardStorage: false }),
  def('permissions', 'global', { softDelete: false, countsTowardStorage: false }),
  def('role_permissions', 'global', {
    softDelete: false,
    primaryKey: 'role_id',
    primaryKeyColumns: ['role_id', 'permission_id'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('user_roles', 'global', { softDelete: true, countsTowardStorage: false }),
  def('access_resources', 'global', { softDelete: false, countsTowardStorage: false }),
  def('role_resource_grants', 'global', {
    softDelete: false,
    primaryKey: 'role_id',
    primaryKeyColumns: ['role_id', 'resource_id'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('iam_config_audit', 'system', { softDelete: false, countsTowardStorage: false }),
  def('field_permissions', 'tenant', { softDelete: false }),
  def('custom_field_labels', 'tenant', { softDelete: false }),
  // ===== Catalogo de UI multi-tenant (texto + menu) =====
  def('ui_text_catalog', 'global', { softDelete: false, countsTowardStorage: false }),
  def('ui_text_overrides', 'global', {
    softDelete: false,
    primaryKey: 'organization_id',
    primaryKeyColumns: ['organization_id', 'text_key', 'locale'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('ui_menu_nodes', 'global', { softDelete: false, countsTowardStorage: false }),
  // invest_assets, invest_ledger_entries: REMOVIDOS — substituidos por
  // patrimony_items + invest_position_ext + patrimony_ledger_entries +
  // financial_accounts + financial_ledger_entries.
  def('invest_daily_snapshots', 'tenant', { softDelete: false }),
  def('invest_portfolio_daily', 'tenant', { softDelete: false }),
  def('invest_position_daily', 'tenant', { softDelete: false, allowHardDelete: true }),
  def('invest_reconciliation_sessions', 'tenant', { softDelete: false }),
  def('invest_reconciliation_day_log', 'tenant', {
    softDelete: false,
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('invest_patrimony_monthly_anchors', 'tenant', { softDelete: false }),
  def('invest_broker_custody_snapshots', 'tenant', { softDelete: false }),
  def('invest_broker_custody_snapshot_lines', 'tenant', {
    softDelete: false,
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('invest_options_chain', 'global', {
    softDelete: false,
    primaryKey: 'ticker',
    countsTowardStorage: false,
  }),
  // ===== Nucleo patrimonial canonico (ver docs/architecture/nucleo_patrimonial.md) =====
  def('patrimony_items', 'tenant'),
  def('patrimony_locations', 'tenant'),
  def('patrimony_item_locations', 'tenant', { softDelete: false }),
  def('patrimony_ledger_entries', 'tenant'),
  def('patrimony_closings', 'tenant', { softDelete: false }),
  def('financial_accounts', 'tenant'),
  def('financial_ledger_entries', 'tenant'),
  def('financial_closings', 'tenant', { softDelete: false }),
  // Elo canonico entre pernas de custodia e pernas de caixa.
  def('business_events', 'tenant'),
  def('module_categories', 'global', {
    softDelete: false,
    primaryKey: 'module_code',
    primaryKeyColumns: ['module_code', 'category', 'subcategory'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('module_valuation_methods', 'global', {
    softDelete: false,
    primaryKey: 'method_code',
    countsTowardStorage: false,
  }),
  def('module_settlement_profiles', 'global', {
    softDelete: false,
    primaryKey: 'profile_code',
    countsTowardStorage: false,
  }),
  def('module_quote_sources', 'global', {
    softDelete: false,
    primaryKey: 'source_code',
    countsTowardStorage: false,
  }),
  def('exchanges', 'global', {
    softDelete: false,
    primaryKey: 'code',
    countsTowardStorage: false,
  }),
  def('fx_rates', 'global', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('market_quote_source_mappings', 'global', {
    softDelete: false,
    primaryKey: 'source_code',
    primaryKeyColumns: ['source_code', 'ticker'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('fee_schedules', 'global', {
    softDelete: false,
    primaryKey: 'fee_schedule_code',
    countsTowardStorage: false,
  }),
  def('fee_schedule_asset_types', 'global', {
    softDelete: false,
    primaryKey: 'fee_schedule_code',
    primaryKeyColumns: ['fee_schedule_code', 'asset_type'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('settlement_counterparties', 'global', {
    softDelete: false,
    primaryKey: 'counterparty_code',
    countsTowardStorage: false,
  }),
  def('settlement_contract_types', 'global', {
    softDelete: false,
    primaryKey: 'contract_type_code',
    countsTowardStorage: false,
  }),
  def('settlement_counterparty_contract_types', 'global', {
    softDelete: false,
    primaryKey: 'counterparty_code',
    primaryKeyColumns: ['counterparty_code', 'contract_type_code'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('settlement_contract_rules', 'global', {
    softDelete: false,
    primaryKey: 'rule_code',
    countsTowardStorage: false,
  }),
  def('settlement_rule_asset_types', 'global', {
    softDelete: false,
    primaryKey: 'rule_code',
    primaryKeyColumns: ['rule_code', 'asset_type'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('settlement_rule_transaction_types', 'global', {
    softDelete: false,
    primaryKey: 'rule_code',
    primaryKeyColumns: ['rule_code', 'transaction_type'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('settlement_rule_ticker_prefixes', 'global', {
    softDelete: false,
    primaryKey: 'rule_code',
    primaryKeyColumns: ['rule_code', 'ticker_prefix'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('invest_position_ext', 'tenant', {
    softDelete: false,
    primaryKey: 'patrimony_item_id',
  }),
  def('invest_option_ext', 'tenant', {
    softDelete: false,
    primaryKey: 'patrimony_item_id',
  }),
  def('invest_options_market', 'global', {
    softDelete: false,
    primaryKey: 'ticker',
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('invest_import_rules', 'global', {
    softDelete: false,
    primaryKey: 'rule_code',
    primaryKeyColumns: ['rule_code', 'broker_id'],
    allowHardDelete: true,
    countsTowardStorage: false,
  }),
  def('invest_asset_type_config', 'global', {
    softDelete: false,
    primaryKey: 'asset_type',
    allowHardDelete: false,
    countsTowardStorage: false,
  }),
  def('invest_ignored_tx_config', 'global', {
    softDelete: false,
    primaryKey: 'operation_type',
    allowHardDelete: false,
    countsTowardStorage: false,
  }),
  def('invest_operation_types', 'global', {
    softDelete: false,
    primaryKey: 'operation_code',
    countsTowardStorage: false,
  }),
  def('invest_operation_policies', 'global', {
    softDelete: false,
    primaryKey: 'operation_code',
    countsTowardStorage: false,
  }),
  def('invest_operation_asset_overrides', 'global', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('invest_brokers', 'global', {
    softDelete: false,
    primaryKey: 'broker_code',
    countsTowardStorage: false,
  }),
  def('invest_broker_aliases', 'global', {
    softDelete: false,
    primaryKey: 'alias_name',
    countsTowardStorage: false,
  }),
  def('invest_cash_account_policies', 'global', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('invest_cash_account_bindings', 'tenant', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('invest_book_periods', 'tenant', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  // ===== Mercado (cotações e índices compartilhados, ver migration 20) =====
  def('invest_options_fetch_cache', 'global', {
    softDelete: false,
    primaryKey: 'ticker',
    primaryKeyColumns: ['ticker', 'quote_date'],
    countsTowardStorage: false,
  }),
  def('market_instruments', 'global', {
    softDelete: false,
    primaryKey: 'ticker',
    countsTowardStorage: false,
  }),
  def('market_quotes_daily', 'global', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('market_index_daily', 'global', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('telemetry_events', 'telemetry', {
    softDelete: false,
    countsTowardStorage: false,
    blockedWritableColumns: new Set([
      ...DEFAULT_BLOCKED,
      'user_id',
      'organization_id',
      'contract_id',
      'role_id',
      'user_role_id',
      'impersonator_user_id',
      'ip_address',
      'user_agent',
    ]),
  }),
  def('audit_logs', 'system', { softDelete: false, countsTowardStorage: false }),
  def('organization_storage_ledger', 'system', {
    softDelete: false,
    countsTowardStorage: false,
  }),
  def('quality_test_runs', 'system', {
    softDelete: false,
    countsTowardStorage: false,
    blockedWritableColumns: new Set([
      ...DEFAULT_BLOCKED,
      'created_at',
    ]),
  }),
  def('platform_scheduled_job_runs', 'system', {
    softDelete: false,
    countsTowardStorage: false,
    blockedWritableColumns: new Set(DEFAULT_BLOCKED),
  }),
  def('platform_admin_alerts', 'system', {
    softDelete: false,
    countsTowardStorage: false,
    blockedWritableColumns: new Set(DEFAULT_BLOCKED),
  }),
  def('database_usage_telemetry', 'system', {
    softDelete: false,
    countsTowardStorage: false,
    blockedWritableColumns: new Set([
      ...DEFAULT_BLOCKED,
      'user_id',
      'organization_id',
      'contract_id',
      'impersonator_user_id',
      'operation_type',
      'target_table',
      'query_key',
      'bytes_in',
      'bytes_out',
      'rows_affected',
      'duration_ms',
    ]),
  }),
];

const BY_NAME = new Map(TABLES.map((t) => [t.name, t]));

/** Identificador SQL seguro: apenas letras, números e underscore */
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

export class TableRegistry {
  static assertRegistered(tableName: string): TableDefinition {
    if (!TABLE_NAME_RE.test(tableName)) {
      throw new GatewayError('TABLE_NOT_ALLOWED', `Nome de tabela inválido: ${tableName}`, 400);
    }
    const def = BY_NAME.get(tableName);
    if (!def) {
      throw new GatewayError(
        'TABLE_NOT_ALLOWED',
        `Tabela não registrada no gateway: ${tableName}`,
        403
      );
    }
    return def;
  }

  static isSystemTable(tableName: string): boolean {
    return TableRegistry.assertRegistered(tableName).kind === 'system';
  }

  static getPrimaryKeyColumns(table: TableDefinition): string[] {
    return table.primaryKeyColumns ?? [table.primaryKey];
  }

  static listStorageCountedTables(): TableDefinition[] {
    return TABLES.filter((table) => table.countsTowardStorage);
  }

  static formatRecordId(table: TableDefinition, row: Record<string, unknown>): string {
    const cols = TableRegistry.getPrimaryKeyColumns(table);
    if (cols.length === 1) {
      return String(row[cols[0]] ?? '');
    }
    return cols.map((c) => String(row[c] ?? '')).join(':');
  }

  static filterWritablePayload(
    table: TableDefinition,
    payload: Record<string, PayloadValue>,
    context: { isInstaller: boolean }
  ): Record<string, PayloadValue> {
    const out: Record<string, PayloadValue> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!/^[a-z][a-z0-9_]*$/i.test(key)) {
        throw new GatewayError('COLUMN_NOT_ALLOWED', `Coluna inválida: ${key}`, 400);
      }
      if (table.blockedWritableColumns.has(key)) {
        if (key === 'organization_id') {
          // Strip — buildSecureInsertPayload / resolveOrganizationId injetam do contexto (ou installer).
          continue;
        }
        throw new GatewayError(
          'COLUMN_NOT_ALLOWED',
          `Coluna protegida não pode ser enviada no payload: ${key}`,
          400
        );
      }
      out[key] = value;
    }
    return out;
  }

  /** Remove colunas injetadas pelo gateway (ex.: organization_id) de filtros de leitura. */
  static filterReadFilters(
    table: TableDefinition,
    filters: Record<string, PayloadValue>
  ): Record<string, PayloadValue> {
    const out: Record<string, PayloadValue> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!/^[a-z][a-z0-9_]*$/i.test(key)) {
        throw new GatewayError('COLUMN_NOT_ALLOWED', `Coluna inválida: ${key}`, 400);
      }
      if (table.blockedWritableColumns.has(key)) {
        continue;
      }
      out[key] = value;
    }
    return out;
  }
}
