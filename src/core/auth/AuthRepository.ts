/**
 * Leituras de autenticação e autorização — via CoCeoDataGateway.readQuery (catálogo GatewayReadQueries).
 */
import { dataGateway } from '../../config/gateway';
import { authBootstrapContext } from './authBootstrapContext';

export interface AuthUserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: boolean;
}

export interface UserContextOption {
  userRoleId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  scope: 'global' | 'node';
  contractId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  contractLabel: string | null;
  isPrimary: boolean;
  permVersion: number;
}

function mapContextRow(row: Record<string, unknown>): UserContextOption {
  return {
    userRoleId: String(row.user_role_id),
    roleId: String(row.role_id),
    roleCode: String(row.role_code),
    roleName: String(row.role_name),
    scope: row.scope as 'global' | 'node',
    contractId: row.contract_id != null ? String(row.contract_id) : null,
    organizationId: row.organization_id != null ? String(row.organization_id) : null,
    organizationName: row.organization_name != null ? String(row.organization_name) : null,
    contractLabel: row.contract_org_name != null ? String(row.contract_org_name) : null,
    isPrimary: !!row.is_primary,
    permVersion: Number(row.perm_version ?? 1),
  };
}

export class AuthRepository {
  private static readonly bootstrapCtx = authBootstrapContext();

  static async findActiveUserByEmail(email: string): Promise<AuthUserRow | null> {
    const rows = await dataGateway.readQuery(
      AuthRepository.bootstrapCtx,
      'auth_user_by_email',
      [email]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      email: String(row.email),
      password_hash: String(row.password_hash),
      full_name: String(row.full_name),
      is_active: !!row.is_active,
    };
  }

  static async listUserContexts(userId: string): Promise<UserContextOption[]> {
    const rows = await dataGateway.readQuery(
      AuthRepository.bootstrapCtx,
      'auth_user_contexts',
      [userId]
    );
    return rows.map(mapContextRow);
  }

  static async findUserContextById(userRoleId: string): Promise<UserContextOption | null> {
    const rows = await dataGateway.readQuery(
      AuthRepository.bootstrapCtx,
      'auth_user_context_by_id',
      [userRoleId]
    );
    if (!rows.length) return null;
    return mapContextRow(rows[0]);
  }

  static async getPermissionCodesForRole(roleId: string): Promise<string[]> {
    const rows = await dataGateway.readQuery(
      AuthRepository.bootstrapCtx,
      'auth_role_permissions',
      [roleId]
    );
    return rows.map((r) => String(r.code));
  }
}
