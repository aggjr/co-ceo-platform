/**
 * Consultas SELECT pré-aprovadas — único caminho para leituras complexas (joins).
 * Não adicionar SQL dinâmico fora deste catálogo.
 */
export type GatewayReadQueryKey =
  | 'auth_user_by_email'
  | 'auth_user_contexts'
  | 'auth_user_context_by_id'
  | 'auth_role_permissions'
  | 'quality_regression_runs'
  | 'cockpit_list_contracts'
  | 'cockpit_contract_by_id'
  | 'cockpit_contract_members'
  | 'cockpit_contract_roles'
  | 'cockpit_contract_modules'
  | 'cockpit_contract_impersonation_targets'
  | 'cockpit_contract_iam_audit'
  | 'cockpit_role_permissions'
  | 'cockpit_role_resources'
  | 'cockpit_role_field_policies'
  | 'cockpit_platform_org_tree'
  | 'cockpit_client_org_tree'
  | 'cockpit_impersonation_targets'
  | 'cockpit_contract_team'
  | 'invest_portfolio_daily_range'
  | 'invest_portfolio_daily_before'
  | 'business_event_orphan_patrimony_legs'
  | 'business_event_orphan_financial_legs'
  | 'invest_ledger_note_refs'
  | 'market_quotes_daily_range'
  | 'market_quotes_daily_on_or_before'
  | 'market_index_daily_range'
  | 'market_index_daily_on_or_before'
  | 'market_distinct_tickers_in_use'
  | 'invest_open_option_tickers'
  | 'market_quotes_bulk_range'
  | 'ui_menu_nodes_active'
  | 'ui_texts_resolved_for_org'
  | 'ui_catalog_version';

export interface GatewayReadQueryDef {
  sql: string;
  /** Exige escopo global (plataforma co-CEO). */
  requiresGlobalScope?: boolean;
  /** Somente SYSTEM_INSTALLER (login, seeds, resolução de permissões internas). */
  bootstrapOnly?: boolean;
}

export const GATEWAY_READ_QUERIES: Record<GatewayReadQueryKey, GatewayReadQueryDef> = {
  auth_user_by_email: {
    bootstrapOnly: true,
    sql: `SELECT id, email, password_hash, full_name, is_active
          FROM users WHERE email = ? AND deleted_at IS NULL`,
  },
  auth_user_contexts: {
    bootstrapOnly: true,
    sql: `SELECT ur.id AS user_role_id, ur.is_primary, ur.contract_id, ur.organization_id,
                 r.id AS role_id, r.code AS role_code, r.name AS role_name, r.scope, r.perm_version,
                 o.name AS organization_name,
                 c.id AS contract_exists,
                 org_root.name AS contract_org_name
          FROM user_roles ur
          INNER JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
          LEFT JOIN organizations o ON o.id = ur.organization_id
          LEFT JOIN contracts c ON c.id = ur.contract_id AND c.deleted_at IS NULL
          LEFT JOIN organizations org_root ON org_root.id = c.organization_id
          WHERE ur.user_id = ? AND ur.deleted_at IS NULL
          ORDER BY ur.is_primary DESC, r.name`,
  },
  auth_user_context_by_id: {
    bootstrapOnly: true,
    sql: `SELECT ur.id AS user_role_id, ur.is_primary, ur.contract_id, ur.organization_id,
                 r.id AS role_id, r.code AS role_code, r.name AS role_name, r.scope, r.perm_version,
                 o.name AS organization_name, org_root.name AS contract_org_name
          FROM user_roles ur
          INNER JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
          LEFT JOIN organizations o ON o.id = ur.organization_id
          LEFT JOIN contracts c ON c.id = ur.contract_id
          LEFT JOIN organizations org_root ON org_root.id = c.organization_id
          WHERE ur.id = ? AND ur.deleted_at IS NULL`,
  },
  auth_role_permissions: {
    bootstrapOnly: true,
    sql: `SELECT p.code FROM role_permissions rp
          INNER JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
  },
  quality_regression_runs: {
    bootstrapOnly: true,
    sql: `SELECT id, run_mode, status, triggered_by_user_id, git_branch, git_commit,
                 total_tests, passed, failed, skipped, coverage_lines_pct, impact_skipped, created_at
          FROM quality_test_runs
          ORDER BY created_at DESC
          LIMIT ?`,
  },
  cockpit_list_contracts: {
    sql: `SELECT c.id, c.organization_id, c.status, c.contract_start_date,
                 o.name AS organization_name, o.storage_bytes_used, o.plan_storage_limit_bytes
          FROM contracts c
          INNER JOIN organizations o ON o.id = c.organization_id
          WHERE c.deleted_at IS NULL
          ORDER BY o.name`,
    requiresGlobalScope: true,
  },
  cockpit_contract_by_id: {
    sql: `SELECT c.*, o.name AS organization_name, o.storage_bytes_used, o.plan_storage_limit_bytes
          FROM contracts c
          INNER JOIN organizations o ON o.id = c.organization_id
          WHERE c.id = ? AND c.deleted_at IS NULL`,
  },
  cockpit_contract_members: {
    sql: `SELECT cu.*, u.email, u.full_name
          FROM contract_users cu
          INNER JOIN users u ON u.id = cu.user_id
          WHERE cu.contract_id = ?`,
  },
  cockpit_contract_roles: {
    sql: `SELECT DISTINCT r.id, r.code, r.name, r.scope
          FROM user_roles ur
          INNER JOIN roles r ON r.id = ur.role_id
          WHERE ur.contract_id = ? AND ur.deleted_at IS NULL`,
  },
  cockpit_contract_modules: {
    sql: `SELECT module_code, status FROM contract_modules WHERE contract_id = ?`,
  },
  cockpit_contract_impersonation_targets: {
    sql: `SELECT ur.id AS user_role_id, u.id AS user_id, u.email, u.full_name,
                 r.name AS role_name, ur.organization_id
          FROM user_roles ur
          INNER JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
          INNER JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
          WHERE ur.contract_id = ? AND ur.deleted_at IS NULL
          ORDER BY u.full_name`,
  },
  cockpit_contract_iam_audit: {
    sql: `SELECT * FROM iam_config_audit WHERE contract_id = ?
          ORDER BY created_at DESC LIMIT 50`,
  },
  cockpit_role_permissions: {
    sql: `SELECT p.code FROM role_permissions rp
          INNER JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
  },
  cockpit_role_resources: {
    sql: `SELECT ar.resource_key, ar.resource_type, ar.label, rrg.effect
          FROM role_resource_grants rrg
          INNER JOIN access_resources ar ON ar.id = rrg.resource_id
          WHERE rrg.role_id = ?`,
  },
  cockpit_role_field_policies: {
    sql: `SELECT table_name, field_name, permission_type, organization_id
          FROM field_permissions WHERE role_id = ?`,
  },
  cockpit_platform_org_tree: {
    sql: `SELECT o.id, o.parent_id, o.name, o.type, o.path,
                 c.id AS contract_id,
                 root.name AS contract_root_name
          FROM contracts c
          INNER JOIN organizations root ON root.id = c.organization_id AND root.deleted_at IS NULL
          INNER JOIN organizations o ON (o.path = root.path OR o.path LIKE CONCAT(root.path, '%'))
            AND o.deleted_at IS NULL
          WHERE c.deleted_at IS NULL
          ORDER BY c.id, o.path`,
    requiresGlobalScope: true,
  },
  cockpit_client_org_tree: {
    sql: `SELECT o.id, o.parent_id, o.name, o.type, o.path,
                 ? AS contract_id,
                 root.name AS contract_root_name
          FROM contracts c
          INNER JOIN organizations root ON root.id = c.organization_id
          INNER JOIN organizations o ON (o.path = ? OR o.path LIKE CONCAT(?, '%')) AND o.deleted_at IS NULL
          WHERE c.id = ? AND c.deleted_at IS NULL
          ORDER BY o.path`,
  },
  cockpit_impersonation_targets: {
    sql: `SELECT ur.id AS user_role_id, u.id AS user_id, u.email, u.full_name,
                 r.name AS role_name, r.code AS role_code, ur.organization_id
          FROM user_roles ur
          INNER JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
          INNER JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
          WHERE ur.contract_id = ?
            AND ur.deleted_at IS NULL
            AND (
              ur.organization_id = ?
              OR (
                ur.organization_id IS NULL
                AND EXISTS (
                  SELECT 1 FROM contract_users cu
                  WHERE cu.contract_id = ur.contract_id
                    AND cu.user_id = ur.user_id
                    AND cu.default_organization_id = ?
                )
              )
              OR (
                ur.organization_id IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM organizations anchor
                  INNER JOIN organizations member ON member.id = ur.organization_id
                    AND member.deleted_at IS NULL
                  WHERE anchor.id = ?
                    AND anchor.deleted_at IS NULL
                    AND (member.path = anchor.path OR member.path LIKE CONCAT(anchor.path, '%'))
                )
              )
            )
            AND (? IS NULL OR u.id <> ?)
            AND (
              ? = FALSE
              OR ur.role_id NOT IN (
                SELECT rp.role_id
                FROM role_permissions rp
                INNER JOIN permissions p ON p.id = rp.permission_id
                WHERE p.code = 'cockpit:impersonate:execute'
              )
            )
          ORDER BY u.full_name, u.email`,
  },
  cockpit_contract_team: {
    sql: `SELECT cu.user_id, cu.status, cu.default_organization_id, u.email, u.full_name,
                 GROUP_CONCAT(DISTINCT r.name SEPARATOR ', ') AS roles
          FROM contract_users cu
          INNER JOIN users u ON u.id = cu.user_id
          LEFT JOIN user_roles ur ON ur.user_id = cu.user_id AND ur.contract_id = cu.contract_id AND ur.deleted_at IS NULL
          LEFT JOIN roles r ON r.id = ur.role_id
          WHERE cu.contract_id = ?
          GROUP BY cu.user_id, cu.status, cu.default_organization_id, u.email, u.full_name`,
  },
  invest_portfolio_daily_range: {
    sql: `SELECT id, organization_id, snapshot_date, patrimony, patrimony_gross, cash,
                 positions_value, pending_settlements, fixed_income_total, external_flow,
                 daily_return_simple, daily_return_twr, cumulative_twr, quotes_as_of, source, metadata
          FROM invest_portfolio_daily
          WHERE organization_id = ?
            AND snapshot_date >= ?
            AND snapshot_date <= ?
          ORDER BY snapshot_date ASC`,
  },
  invest_portfolio_daily_before: {
    sql: `SELECT id, organization_id, snapshot_date, patrimony, patrimony_gross, cash,
                 positions_value, pending_settlements, fixed_income_total, external_flow,
                 daily_return_simple, daily_return_twr, cumulative_twr, quotes_as_of, source, metadata
          FROM invest_portfolio_daily
          WHERE organization_id = ?
            AND snapshot_date < ?
          ORDER BY snapshot_date DESC
          LIMIT 1`,
  },
  business_event_orphan_patrimony_legs: {
    sql: `SELECT id, organization_id, patrimony_item_id, transaction_date, movement_type,
                 quantity_delta, unit_value, total_value, external_ref
          FROM patrimony_ledger_entries
          WHERE organization_id = ?
            AND business_event_id IS NULL
            AND deleted_at IS NULL
            AND transaction_date >= ?
            AND transaction_date <= ?
          ORDER BY transaction_date ASC, created_at ASC
          LIMIT ?`,
  },
  business_event_orphan_financial_legs: {
    sql: `SELECT id, organization_id, account_id, transaction_date, settlement_date,
                 direction, amount, status, description, external_ref
          FROM financial_ledger_entries
          WHERE organization_id = ?
            AND business_event_id IS NULL
            AND deleted_at IS NULL
            AND transaction_date >= ?
            AND transaction_date <= ?
          ORDER BY transaction_date ASC, created_at ASC
          LIMIT ?`,
  },
  invest_ledger_note_refs: {
    sql: `SELECT DISTINCT
            CASE
              WHEN external_ref LIKE 'BROKER_REF:%'
              THEN SUBSTRING(external_ref, 12)
              ELSE external_ref
            END AS broker_note_ref
          FROM financial_ledger_entries
          WHERE organization_id = ?
            AND external_ref IS NOT NULL
            AND deleted_at IS NULL`,
  },
  market_quotes_daily_range: {
    sql: `SELECT id, ticker, quote_date, closing_price, open_price, min_price, max_price,
                 volume, currency, source, source_fetched_at, metadata
          FROM market_quotes_daily
          WHERE ticker = ?
            AND quote_date >= ?
            AND quote_date <= ?
          ORDER BY quote_date ASC`,
  },
  market_quotes_daily_on_or_before: {
    sql: `SELECT id, ticker, quote_date, closing_price, source
          FROM market_quotes_daily
          WHERE ticker = ?
            AND quote_date <= ?
          ORDER BY quote_date DESC
          LIMIT 1`,
  },
  market_index_daily_range: {
    sql: `SELECT id, index_code, reference_date, daily_factor, annualized_rate, source
          FROM market_index_daily
          WHERE index_code = ?
            AND reference_date >= ?
            AND reference_date <= ?
          ORDER BY reference_date ASC`,
  },
  market_index_daily_on_or_before: {
    sql: `SELECT id, index_code, reference_date, daily_factor, annualized_rate, source
          FROM market_index_daily
          WHERE index_code = ?
            AND reference_date <= ?
          ORDER BY reference_date DESC
          LIMIT 1`,
  },
  market_quotes_bulk_range: {
    sql: `SELECT ticker, quote_date, closing_price, source
          FROM market_quotes_daily
          WHERE quote_date >= ?
            AND quote_date <= ?
          ORDER BY ticker ASC, quote_date ASC`,
  },
  market_distinct_tickers_in_use: {
    requiresGlobalScope: true,
    sql: `SELECT DISTINCT pi.identifier AS ticker, ipe.asset_class
          FROM patrimony_items pi
          LEFT JOIN invest_position_ext ipe ON ipe.patrimony_item_id = pi.id
          WHERE pi.source_module = 'INVEST'
            AND pi.status = 'active'
            AND pi.deleted_at IS NULL
            AND pi.identifier NOT LIKE 'CAIXA-%'
            AND pi.identifier NOT LIKE 'TESOURO-%'
            AND pi.identifier NOT LIKE 'CDB-%'
            AND pi.identifier NOT LIKE 'LFT-%'
            AND pi.identifier NOT LIKE 'TD-%'
          ORDER BY pi.identifier`,
  },
  invest_open_option_tickers: {
    requiresGlobalScope: true,
    sql: `SELECT DISTINCT pi.identifier AS ticker
          FROM patrimony_items pi
          WHERE pi.source_module = 'INVEST'
            AND pi.status = 'active'
            AND pi.deleted_at IS NULL
            AND ABS(pi.quantity) > 0.0001
            AND pi.identifier REGEXP '^[A-Z]{4}[A-X][0-9]'
            AND pi.identifier NOT LIKE 'CAIXA-%'
          ORDER BY pi.identifier`,
  },
  ui_menu_nodes_active: {
    sql: `SELECT id, code, parent_id, module_code, path, icon, order_index,
                 text_key, access_resource_key, visibility
          FROM ui_menu_nodes
          WHERE is_active = TRUE
          ORDER BY parent_id IS NULL DESC, parent_id, order_index, code`,
  },
  ui_texts_resolved_for_org: {
    sql: `SELECT c.text_key, c.kind, c.module_code,
                 COALESCE(o.text, c.default_text) AS text,
                 COALESCE(o.metadata, c.metadata) AS metadata,
                 (o.organization_id IS NOT NULL) AS is_overridden
          FROM ui_text_catalog c
          LEFT JOIN ui_text_overrides o
            ON o.text_key = c.text_key
           AND o.locale = c.locale
           AND o.organization_id = ?
          WHERE c.locale = ?`,
  },
  ui_catalog_version: {
    sql: `SELECT
            COALESCE(MAX(updated_at), '1970-01-01') AS catalog_at,
            (SELECT COALESCE(MAX(updated_at), '1970-01-01') FROM ui_menu_nodes) AS menu_at,
            (SELECT COALESCE(MAX(updated_at), '1970-01-01')
               FROM ui_text_overrides WHERE organization_id = ?) AS overrides_at
          FROM ui_text_catalog`,
  },
};
