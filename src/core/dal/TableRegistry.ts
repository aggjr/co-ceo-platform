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
  // invest_assets, invest_ledger_entries: REMOVIDOS — substituidos por
  // patrimony_items + invest_position_ext + patrimony_ledger_entries +
  // financial_accounts + financial_ledger_entries.
  def('invest_daily_snapshots', 'tenant', { softDelete: false }),
  def('invest_portfolio_daily', 'tenant', { softDelete: false }),
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
        if (key === 'organization_id' && context.isInstaller) {
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
}
