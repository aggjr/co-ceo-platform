/**
 * Leituras do Cockpit — somente via CoCeoDataGateway.readQuery (catálogo GatewayReadQueries).
 */
import { RowDataPacket } from 'mysql2';
import { dataGateway } from '../../config/gateway';
import type { UserContext } from '../dal/types';

export class CockpitReadRepository {
  static async listContractsForPlatform(ctx: UserContext): Promise<RowDataPacket[]> {
    return dataGateway.readQuery(ctx, 'cockpit_list_contracts') as Promise<RowDataPacket[]>;
  }

  static async getContractIamSnapshot(
    ctx: UserContext,
    contractId: string
  ): Promise<{
    contract: RowDataPacket | null;
    members: RowDataPacket[];
    roles: RowDataPacket[];
    modules: RowDataPacket[];
    impersonationTargets: RowDataPacket[];
    recentIamAudit: RowDataPacket[];
  }> {
    const [contractRows, members, roles, modules, targets, audit] = await Promise.all([
      dataGateway.readQuery(ctx, 'cockpit_contract_by_id', [contractId]),
      dataGateway.readQuery(ctx, 'cockpit_contract_members', [contractId]),
      dataGateway.readQuery(ctx, 'cockpit_contract_roles', [contractId]),
      dataGateway.readQuery(ctx, 'cockpit_contract_modules', [contractId]),
      dataGateway.readQuery(ctx, 'cockpit_contract_impersonation_targets', [contractId]),
      dataGateway.readQuery(ctx, 'cockpit_contract_iam_audit', [contractId]),
    ]);
    return {
      contract: (contractRows[0] as RowDataPacket) ?? null,
      members: members as RowDataPacket[],
      roles: roles as RowDataPacket[],
      modules: modules as RowDataPacket[],
      impersonationTargets: targets as RowDataPacket[],
      recentIamAudit: audit as RowDataPacket[],
    };
  }

  static async getAccessMatrixForRole(
    ctx: UserContext,
    roleId: string
  ): Promise<{
    permissions: string[];
    resources: { key: string; type: string; label: string; effect: string }[];
    fieldPolicies: RowDataPacket[];
  }> {
    const [permRows, resourceRows, fieldRows] = await Promise.all([
      dataGateway.readQuery(ctx, 'cockpit_role_permissions', [roleId]),
      dataGateway.readQuery(ctx, 'cockpit_role_resources', [roleId]),
      dataGateway.readQuery(ctx, 'cockpit_role_field_policies', [roleId]),
    ]);
    return {
      permissions: permRows.map((r) => String(r.code)),
      resources: resourceRows.map((r) => ({
        key: String(r.resource_key),
        type: String(r.resource_type),
        label: String(r.label),
        effect: String(r.effect),
      })),
      fieldPolicies: fieldRows as RowDataPacket[],
    };
  }

  static async listOrgTreeForPlatform(ctx: UserContext): Promise<RowDataPacket[]> {
    return dataGateway.readQuery(ctx, 'cockpit_platform_org_tree') as Promise<RowDataPacket[]>;
  }

  static async listOrgTreeForClient(
    ctx: UserContext,
    contractId: string,
    scopeOrganizationId: string
  ): Promise<RowDataPacket[]> {
    const anchor = await dataGateway.findById(ctx, 'organizations', scopeOrganizationId);
    if (!anchor?.path) {
      return [];
    }
    const prefix = String(anchor.path);
    return dataGateway.readQuery(ctx, 'cockpit_client_org_tree', [
      contractId,
      prefix,
      prefix,
      contractId,
    ]) as Promise<RowDataPacket[]>;
  }

  static async listImpersonationTargets(
    ctx: UserContext,
    contractId: string,
    organizationId: string,
    options?: { excludeUserId?: string | null; excludeClientImpersonators?: boolean }
  ): Promise<RowDataPacket[]> {
    const excludeUserId = options?.excludeUserId ?? null;
    const excludeClientImpersonators = options?.excludeClientImpersonators ?? false;
    return dataGateway.readQuery(ctx, 'cockpit_impersonation_targets', [
      contractId,
      organizationId,
      organizationId,
      organizationId,
      excludeUserId,
      excludeUserId,
      excludeClientImpersonators,
    ]) as Promise<RowDataPacket[]>;
  }

  static async listTeamForContract(
    ctx: UserContext,
    contractId: string
  ): Promise<RowDataPacket[]> {
    return dataGateway.readQuery(ctx, 'cockpit_contract_team', [
      contractId,
    ]) as Promise<RowDataPacket[]>;
  }
}
