import mysql from 'mysql2/promise';
import { GatewayError } from './errors';
import { TableRegistry } from './TableRegistry';
import type { AuditAction, UserContext } from './types';

export function estimatePayloadBytes(payload: Record<string, unknown> | null): number {
  if (!payload || Object.keys(payload).length === 0) {
    return 0;
  }
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

export function computeStorageDelta(
  action: AuditAction,
  oldPayload: Record<string, unknown> | null,
  newPayload: Record<string, unknown> | null
): number {
  const oldBytes = estimatePayloadBytes(oldPayload);
  const newBytes = estimatePayloadBytes(newPayload);
  switch (action) {
    case 'INSERT':
      return newBytes;
    case 'UPDATE':
      return newBytes - oldBytes;
    case 'SOFT_DELETE':
      return -oldBytes;
    default:
      return 0;
  }
}

export class StorageMeter {
  /**
   * Verifica limite do plano antes de mutação que aumenta uso.
   */
  static async assertWithinPlanLimit(
    connection: mysql.Connection,
    organizationId: string,
    additionalBytes: number
  ): Promise<void> {
    if (additionalBytes <= 0) {
      return;
    }
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT storage_bytes_used, plan_storage_limit_bytes
       FROM organizations WHERE id = ? AND deleted_at IS NULL`,
      [organizationId]
    );
    if (!rows.length) {
      throw new GatewayError('ORG_NOT_FOUND', 'Organização não encontrada para cobrança.', 404);
    }
    const used = Number(rows[0].storage_bytes_used ?? 0);
    const limit = rows[0].plan_storage_limit_bytes;
    if (limit == null) {
      return;
    }
    const limitNum = Number(limit);
    if (used + additionalBytes > limitNum) {
      throw new GatewayError(
        'STORAGE_LIMIT_EXCEEDED',
        `Limite de armazenamento excedido (${used + additionalBytes} > ${limitNum} bytes).`,
        402
      );
    }
  }

  static async applyDelta(
    connection: mysql.Connection,
    context: UserContext,
    organizationId: string,
    deltaBytes: number,
    meta: { tableName: string; recordId: string; action: AuditAction }
  ): Promise<void> {
    if (!organizationId || deltaBytes === 0) {
      return;
    }

    await connection.execute(
      `INSERT INTO organization_storage_ledger (
        organization_id, delta_bytes, source_table, record_id, action, actor_user_id
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        organizationId,
        deltaBytes,
        meta.tableName,
        meta.recordId,
        meta.action,
        context.userId,
      ]
    );

    await connection.execute(
      `UPDATE organizations
       SET storage_bytes_used = GREATEST(0, storage_bytes_used + ?)
       WHERE id = ?`,
      [deltaBytes, organizationId]
    );
  }

  /**
   * Zera o hodômetro da organização após purge em massa (DELETE direto, fora do gateway).
   * Remove o ledger da org para o próximo mapeamento recontar só via applyDelta.
   */
  static async resetOrganizationUsage(
    connection: mysql.Connection | mysql.PoolConnection | mysql.Pool,
    organizationId: string
  ): Promise<{ previousBytes: number }> {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT storage_bytes_used FROM organizations WHERE id = ? AND deleted_at IS NULL`,
      [organizationId]
    );
    if (!rows.length) {
      throw new GatewayError('ORG_NOT_FOUND', 'Organização não encontrada para cobrança.', 404);
    }
    const previousBytes = Number(rows[0].storage_bytes_used ?? 0);

    await connection.execute(
      `DELETE FROM organization_storage_ledger WHERE organization_id = ?`,
      [organizationId]
    );
    await connection.execute(
      `UPDATE organizations SET storage_bytes_used = 0 WHERE id = ?`,
      [organizationId]
    );

    return { previousBytes };
  }

  /**
   * Recalcula o hodometro a partir das linhas atuais que contam para storage.
   * Use apos purges/importacoes diretas por SQL, quando os deltas do gateway
   * nao representam mais a base real.
   */
  static async recalculateOrganizationUsage(
    connection: mysql.Connection | mysql.PoolConnection | mysql.Pool,
    organizationId: string
  ): Promise<{ previousBytes: number; recalculatedBytes: number; tablesScanned: number }> {
    const [orgRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT storage_bytes_used FROM organizations WHERE id = ? AND deleted_at IS NULL`,
      [organizationId]
    );
    if (!orgRows.length) {
      throw new GatewayError('ORG_NOT_FOUND', 'Organizacao nao encontrada para cobranca.', 404);
    }

    const previousBytes = Number(orgRows[0].storage_bytes_used ?? 0);
    let recalculatedBytes = 0;
    let tablesScanned = 0;

    for (const table of TableRegistry.listStorageCountedTables()) {
      const where = table.softDelete
        ? 'organization_id = ? AND deleted_at IS NULL'
        : 'organization_id = ?';
      try {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT * FROM \`${table.name}\` WHERE ${where}`,
          [organizationId]
        );
        tablesScanned += 1;
        for (const row of rows) {
          recalculatedBytes += estimatePayloadBytes({ ...row });
        }
      } catch (error) {
        const mysqlError = error as { code?: string };
        if (mysqlError.code === 'ER_NO_SUCH_TABLE' || mysqlError.code === 'ER_BAD_FIELD_ERROR') {
          continue;
        }
        throw error;
      }
    }

    await connection.execute(
      `DELETE FROM organization_storage_ledger WHERE organization_id = ?`,
      [organizationId]
    );
    await connection.execute(
      `UPDATE organizations SET storage_bytes_used = ? WHERE id = ?`,
      [recalculatedBytes, organizationId]
    );

    return { previousBytes, recalculatedBytes, tablesScanned };
  }
}
