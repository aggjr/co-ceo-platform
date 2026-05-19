import { RowDataPacket } from 'mysql2';
import pool from '../../config/database';
import { GatewayError } from '../dal/errors';

export type FieldPermissionType = 'read' | 'write' | 'hidden' | 'mask';

interface FieldRule {
  field_name: string;
  permission_type: FieldPermissionType;
}

export class FieldPolicyService {
  private static cache = new Map<string, { rules: FieldRule[]; expires: number }>();

  private static cacheKey(roleId: string, organizationId: string, table: string): string {
    return `${roleId}:${organizationId}:${table}`;
  }

  static async getRules(
    roleId: string,
    organizationId: string,
    tableName: string
  ): Promise<FieldRule[]> {
    const key = this.cacheKey(roleId, organizationId, tableName);
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return hit.rules;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT field_name, permission_type FROM field_permissions
       WHERE role_id = ? AND organization_id = ? AND table_name = ?`,
      [roleId, organizationId, tableName]
    );
    const rules = rows as FieldRule[];
    this.cache.set(key, { rules, expires: Date.now() + 60_000 });
    return rules;
  }

  static async assertCanWrite(
    roleId: string | undefined,
    organizationId: string | null,
    tableName: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!roleId || !organizationId) {
      return;
    }
    const rules = await this.getRules(roleId, organizationId, tableName);
    for (const field of Object.keys(payload)) {
      const rule = rules.find((r) => r.field_name === field);
      if (rule && (rule.permission_type === 'hidden' || rule.permission_type === 'read')) {
        throw new GatewayError(
          'COLUMN_NOT_ALLOWED',
          `Campo "${field}" não pode ser alterado com o papel atual.`,
          403
        );
      }
    }
  }

  static async filterRowForRead(
    roleId: string | undefined,
    organizationId: string | null,
    tableName: string,
    row: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!roleId || !organizationId) {
      return row;
    }
    const rules = await this.getRules(roleId, organizationId, tableName);
    const out = { ...row };
    for (const rule of rules) {
      if (rule.permission_type === 'hidden') {
        delete out[rule.field_name];
      } else if (rule.permission_type === 'mask' && out[rule.field_name] != null) {
        out[rule.field_name] = '***';
      }
    }
    return out;
  }
}
