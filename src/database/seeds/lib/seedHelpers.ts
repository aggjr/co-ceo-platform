import { CoCeoDataGateway, GatewayError } from '../../../core/dal';
import type { SecurePayload, UserContext } from '../../../core/dal';
import { IamAuditService } from '../../../core/auth/IamAuditService';

/** Leitura por chave natural — via gateway (installer). */
export async function findIdByColumn(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  table: string,
  column: string,
  value: string
): Promise<string | null> {
  const rows = await gateway.findWhere(ctx, table, { [column]: value }, {
    limit: 1,
    columns: ['id'],
  });
  return rows[0]?.id ? String(rows[0].id) : null;
}

function isDuplicateKeyError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number };
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

export async function ensureInsert(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  table: string,
  recordId: string,
  payload: SecurePayload,
  audit?: { entityType: string; changeType?: string }
): Promise<'inserted' | 'skipped'> {
  try {
    const existing = await gateway.findById(ctx, table, recordId);
    if (existing) return 'skipped';
  } catch (error) {
    if (!(error instanceof GatewayError) || error.code !== 'TABLE_NOT_ALLOWED') {
      throw error;
    }
  }

  try {
    await gateway.insert(ctx, table, { ...payload, id: recordId });
    if (audit) {
      const iamAudit = new IamAuditService(gateway);
      await iamAudit.logChange(ctx, {
        changeType: audit.changeType ?? 'SEED_INSERT',
        entityType: audit.entityType,
        entityId: recordId,
        newPayload: payload as Record<string, unknown>,
      });
    }
    return 'inserted';
  } catch (error) {
    if (isDuplicateKeyError(error)) return 'skipped';
    throw error;
  }
}

export async function ensureLink(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  table: string,
  payload: SecurePayload,
  audit?: { entityType: string; entityId: string }
): Promise<'inserted' | 'skipped'> {
  try {
    await gateway.insert(ctx, table, payload);
    if (audit) {
      const iamAudit = new IamAuditService(gateway);
      await iamAudit.logChange(ctx, {
        changeType: 'SEED_LINK',
        entityType: audit.entityType,
        entityId: audit.entityId,
        newPayload: payload as Record<string, unknown>,
      });
    }
    return 'inserted';
  } catch (error) {
    if (isDuplicateKeyError(error)) return 'skipped';
    throw error;
  }
}

/** Revoga vínculo IAM (hard delete auditado no gateway). */
export async function ensureRevokeLink(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  table: string,
  match: SecurePayload,
  audit?: { entityType: string; entityId: string }
): Promise<'revoked' | 'skipped'> {
  const deleted = await gateway.deleteMatching(ctx, table, match);
  if (deleted === 0) return 'skipped';
  if (audit) {
    const iamAudit = new IamAuditService(gateway);
    await iamAudit.logChange(ctx, {
      changeType: 'SEED_REVOKE',
      entityType: audit.entityType,
      entityId: audit.entityId,
      oldPayload: match as Record<string, unknown>,
    });
  }
  return 'revoked';
}

/** Mantém apenas permission_ids listados no papel. */
export async function syncRolePermissions(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  roleId: string,
  keepPermissionIds: string[]
): Promise<void> {
  const links = await gateway.findWhere(ctx, 'role_permissions', { role_id: roleId });
  const keep = new Set(keepPermissionIds);
  for (const link of links) {
    const permissionId = String(link.permission_id);
    if (!keep.has(permissionId)) {
      await ensureRevokeLink(
        gateway,
        ctx,
        'role_permissions',
        { role_id: roleId, permission_id: permissionId },
        { entityType: 'role_permissions', entityId: roleId }
      );
    }
  }
}

/** Mantém apenas resource_ids listados no papel. */
export async function syncRoleResourceGrants(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  roleId: string,
  keepResourceIds: string[]
): Promise<void> {
  const links = await gateway.findWhere(ctx, 'role_resource_grants', { role_id: roleId });
  const keep = new Set(keepResourceIds);
  for (const link of links) {
    const resourceId = String(link.resource_id);
    if (!keep.has(resourceId)) {
      await ensureRevokeLink(
        gateway,
        ctx,
        'role_resource_grants',
        { role_id: roleId, resource_id: resourceId },
        { entityType: 'role_resource_grants', entityId: roleId }
      );
    }
  }
}
