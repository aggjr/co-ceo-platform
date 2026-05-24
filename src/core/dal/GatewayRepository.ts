import mysql from 'mysql2/promise';
import { GatewayError } from './errors';
import { SecurityScopeResolver, type ScopeClause } from './SecurityScope';
import { FieldPolicyService } from '../auth/FieldPolicyService';
import { StorageMeter, computeStorageDelta } from './StorageMeter';
import { TableRegistry, type TableDefinition } from './TableRegistry';
import {
  GATEWAY_READ_QUERIES,
  type GatewayReadQueryKey,
} from './GatewayReadQueries';
import type {
  AuditAction,
  InsertResult,
  SecurePayload,
  UserContext,
} from './types';
import type { TelemetryEventInput, TelemetryIngestMeta } from '../telemetry/types';
import { SYSTEM_INSTALLER_USER_ID } from './types';

export class GatewayRepository {
  private pathPrefix: string | null = null;

  constructor(
    private readonly connection: mysql.Connection,
    private readonly context: UserContext
  ) {}

  /**
   * Registra métricas de uso e volumetria do banco de dados (bytes de entrada/saída, tempo de execução).
   * Totalmente resiliente e sem risco de recursão em tabelas internas de auditoria/telemetria.
   */
  private async logDbTelemetry(
    operation: string,
    tableName: string | null,
    queryKey: string | null,
    params: unknown[],
    result: unknown,
    durationMs: number
  ): Promise<void> {
    // Evita recursão infinita ao gravar logs da própria tabela de telemetria ou logs de auditoria
    if (
      tableName === 'database_usage_telemetry' ||
      tableName === 'audit_logs'
    ) {
      return;
    }

    try {
      const bytesIn = JSON.stringify(params || []).length;
      let bytesOut = 0;
      let rowsAffected = 0;

      if (Array.isArray(result)) {
        bytesOut = JSON.stringify(result).length;
        rowsAffected = result.length;
      } else if (result && typeof result === 'object') {
        bytesOut = JSON.stringify(result).length;
        if ('affectedRows' in result) {
          rowsAffected = (result as any).affectedRows || 0;
        } else {
          rowsAffected = 1;
        }
      }

      // Executa diretamente na conexão crua (ignora regras do gateway para evitar loops)
      await this.connection.execute(
        `INSERT INTO database_usage_telemetry (
          user_id, organization_id, contract_id, impersonator_user_id,
          operation_type, target_table, query_key, bytes_in, bytes_out,
          rows_affected, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.context.userId || 'SYSTEM',
          this.context.organizationId || null,
          this.context.contractId || null,
          this.context.impersonatorId || null,
          operation,
          tableName || null,
          queryKey || null,
          bytesIn,
          bytesOut,
          rowsAffected,
          durationMs,
        ]
      );
    } catch (err) {
      // Falha silenciosa para nunca interromper a transação de negócio principal
      console.error('Erro ao salvar telemetria do banco de dados:', err);
    }
  }

  private isInstaller(): boolean {
    return this.context.userId === SYSTEM_INSTALLER_USER_ID;
  }

  private async getPathPrefix(): Promise<string | null> {
    if (this.context.scope === 'global' || !this.context.organizationId) {
      return null;
    }
    if (!this.pathPrefix) {
      this.pathPrefix = await SecurityScopeResolver.resolvePathPrefix(
        this.connection,
        this.context.organizationId
      );
    }
    return this.pathPrefix;
  }

  private async tenantScope(): Promise<ScopeClause> {
    const prefix = await this.getPathPrefix();
    return SecurityScopeResolver.buildTenantScopeClause(this.context, prefix);
  }

  private sanitizeValues(payload: SecurePayload): unknown[] {
    return Object.values(payload).map((val) => {
      if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
        return JSON.stringify(val);
      }
      return val;
    });
  }

  private resolveOrganizationId(
    table: TableDefinition,
    payload: SecurePayload
  ): string | null {
    if (table.kind !== 'tenant') {
      return null;
    }
    if (this.isInstaller() && payload.organization_id != null) {
      return String(payload.organization_id);
    }
    if (!this.context.organizationId) {
      throw new GatewayError(
        'TENANT_ISOLATION_FAILED',
        'Usuário sem organização não pode gravar em tabela transacional.',
        403
      );
    }
    return this.context.organizationId;
  }

  private buildSecureInsertPayload(
    table: TableDefinition,
    payload: SecurePayload
  ): SecurePayload {
    const filtered = TableRegistry.filterWritablePayload(table, payload, {
      isInstaller: this.isInstaller(),
    }) as SecurePayload;

    const orgId = this.resolveOrganizationId(table, payload);
    if (table.kind === 'tenant' && orgId) {
      return { ...filtered, organization_id: orgId };
    }
    return filtered;
  }

  private async registerAuditLog(
    tableName: string,
    recordId: string,
    action: AuditAction,
    oldPayload: Record<string, unknown> | null,
    newPayload: Record<string, unknown> | null,
    organizationId: string | null
  ): Promise<void> {
    await this.connection.execute(
      `INSERT INTO audit_logs (
        table_name, record_id, action, organization_id,
        actor_user_id, impersonator_user_id, old_payload, new_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tableName,
        recordId,
        action,
        organizationId,
        this.context.userId,
        this.context.impersonatorId,
        oldPayload ? JSON.stringify(oldPayload) : null,
        newPayload ? JSON.stringify(newPayload) : null,
      ]
    );
  }

  private resolveRecordId(
    table: TableDefinition,
    result: mysql.ResultSetHeader,
    securePayload: SecurePayload
  ): string {
    if (result.insertId) {
      return String(result.insertId);
    }
    const pkCols = TableRegistry.getPrimaryKeyColumns(table);
    if (pkCols.every((c) => securePayload[c] != null)) {
      return TableRegistry.formatRecordId(table, securePayload as Record<string, unknown>);
    }
    const pk = securePayload[table.primaryKey];
    if (pk != null) {
      return String(pk);
    }
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(securePayload).filter(([k]) =>
          [...pkCols, 'module_code'].includes(k)
        )
      )
    );
  }

  private async recordStorage(
    table: TableDefinition,
    organizationId: string | null,
    action: AuditAction,
    recordId: string,
    oldPayload: Record<string, unknown> | null,
    newPayload: Record<string, unknown> | null
  ): Promise<void> {
    if (!table.countsTowardStorage || !organizationId) {
      return;
    }
    const delta = computeStorageDelta(action, oldPayload, newPayload);
    if (delta > 0) {
      await StorageMeter.assertWithinPlanLimit(this.connection, organizationId, delta);
    }
    await StorageMeter.applyDelta(this.connection, this.context, organizationId, delta, {
      tableName: table.name,
      recordId,
      action,
    });
  }

  async insertTelemetryBatch(
    events: TelemetryEventInput[],
    meta: TelemetryIngestMeta
  ): Promise<void> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered('telemetry_events');
      if (table.kind !== 'telemetry') {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Tabela de telemetria inválida.', 500);
      }

      for (const event of events) {
        const clientPayload = TableRegistry.filterWritablePayload(
          table,
          {
            event_type: event.event_type,
            event_name: event.event_name,
            module_code: event.module_code ?? null,
            screen_path: event.screen_path ?? null,
            session_id: event.session_id ?? null,
            metadata: (event.metadata ?? null) as SecurePayload['metadata'],
            client_timestamp: event.client_timestamp ?? null,
          },
          { isInstaller: false }
        ) as SecurePayload;

        const row: SecurePayload = {
          user_id: this.context.userId,
          organization_id: this.context.organizationId,
          contract_id: this.context.contractId ?? null,
          role_id: this.context.roleId ?? null,
          user_role_id: this.context.userRoleId ?? null,
          impersonator_user_id: this.context.impersonatorId,
          ip_address: meta.ipAddress ?? null,
          user_agent: meta.userAgent ?? null,
          ...clientPayload,
        };

        const keys = Object.keys(row);
        const values = this.sanitizeValues(row);
        const placeholders = keys.map(() => '?').join(', ');

        await this.connection.execute(
          `INSERT INTO \`telemetry_events\` (${keys.map((k) => `\`${k}\``).join(', ')})
           VALUES (${placeholders})`,
          values as (string | number | boolean | Date | null | Buffer)[]
        );
      }

      await this.logDbTelemetry(
        'INSERT_TELEMETRY_BATCH',
        'telemetry_events',
        null,
        events,
        { affectedRows: events.length },
        Date.now() - start
      );
    } catch (err) {
      await this.logDbTelemetry(
        'INSERT_TELEMETRY_BATCH_FAILED',
        'telemetry_events',
        null,
        events,
        null,
        Date.now() - start
      );
      throw err;
    }
  }

  async insert(tableName: string, payload: SecurePayload): Promise<InsertResult> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered(tableName);
      if (table.kind === 'telemetry') {
        throw new GatewayError(
          'TABLE_NOT_ALLOWED',
          'Use recordTelemetryEvents para telemetria.',
          400
        );
      }
      if (table.kind === 'system' && !this.isInstaller()) {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Tabela de sistema.', 403);
      }
      if (!Object.keys(payload).length) {
        throw new GatewayError('EMPTY_PAYLOAD', 'Payload vazio.', 400);
      }

      const securePayload =
        table.kind === 'system'
          ? (TableRegistry.filterWritablePayload(table, payload, {
              isInstaller: true,
            }) as SecurePayload)
          : this.buildSecureInsertPayload(table, payload);

      if (table.kind === 'tenant') {
        await FieldPolicyService.assertCanWrite(
          this.context.roleId,
          this.context.organizationId,
          tableName,
          securePayload as Record<string, unknown>
        );
      }
      const orgId =
        table.kind === 'tenant'
          ? String(securePayload.organization_id)
          : (securePayload.organization_id as string | undefined) ?? null;

      const keys = Object.keys(securePayload);
      const values = this.sanitizeValues(securePayload);
      const placeholders = keys.map(() => '?').join(', ');

      const [result] = await this.connection.execute(
        `INSERT INTO \`${table.name}\` (${keys.map((k) => `\`${k}\``).join(', ')})
         VALUES (${placeholders})`,
        values as (string | number | boolean | Date | null | Buffer)[]
      );

      const header = result as unknown as mysql.ResultSetHeader;
      const recordId = this.resolveRecordId(table, header, securePayload);
      const newRecord = { ...securePayload } as Record<string, unknown>;

      if (table.kind !== 'system') {
        await this.registerAuditLog(tableName, recordId, 'INSERT', null, newRecord, orgId);
      }
      await this.recordStorage(table, orgId, 'INSERT', recordId, null, newRecord);

      const res = {
        insertId: header.insertId || null,
        recordId,
        affectedRows: header.affectedRows,
      };

      await this.logDbTelemetry('INSERT', tableName, null, [payload], res, Date.now() - start);
      return res;
    } catch (err) {
      await this.logDbTelemetry('INSERT_FAILED', tableName, null, [payload], null, Date.now() - start);
      throw err;
    }
  }

  async update(
    tableName: string,
    recordId: string,
    payload: SecurePayload
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered(tableName);
      if (table.kind === 'system' && !this.isInstaller()) {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Tabela de sistema.', 403);
      }
      if (!Object.keys(payload).length) {
        throw new GatewayError('EMPTY_PAYLOAD', 'Payload vazio.', 400);
      }

      const filtered =
        table.kind === 'system'
          ? (TableRegistry.filterWritablePayload(table, payload, {
              isInstaller: true,
            }) as SecurePayload)
          : (TableRegistry.filterWritablePayload(table, payload, {
              isInstaller: this.isInstaller(),
            }) as SecurePayload);

      if (table.kind === 'tenant') {
        await FieldPolicyService.assertCanWrite(
          this.context.roleId,
          this.context.organizationId,
          tableName,
          filtered as Record<string, unknown>
        );
      }

      const scope = table.kind === 'tenant' ? await this.tenantScope() : { sql: '1=1', params: [] };
      const softClause = table.softDelete ? ' AND deleted_at IS NULL' : '';

      const [oldRows] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT * FROM \`${table.name}\`
         WHERE \`${table.primaryKey}\` = ? AND ${scope.sql}${softClause}`,
        [recordId, ...scope.params]
      );

      if (!oldRows.length) {
        throw new GatewayError('ACCESS_DENIED', 'Acesso negado ou registro inexistente.', 403);
      }

      const oldRow = { ...oldRows[0] } as Record<string, unknown>;
      const orgId =
        table.kind === 'tenant' ? String(oldRow.organization_id ?? '') : null;

      const keys = Object.keys(filtered);
      const values = this.sanitizeValues(filtered);
      const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');

      const [updateResult] = await this.connection.execute(
        `UPDATE \`${table.name}\` SET ${setClause}
         WHERE \`${table.primaryKey}\` = ? AND ${scope.sql}${softClause}`,
        [...values, recordId, ...scope.params] as (string | number | boolean | Date | null | Buffer)[]
      );

      const header = updateResult as unknown as mysql.ResultSetHeader;
      if (header.affectedRows === 0) {
        throw new GatewayError('RECORD_NOT_FOUND', 'Registro não encontrado ou deletado.', 404);
      }

      const newRow = { ...oldRow, ...filtered } as Record<string, unknown>;
      await this.registerAuditLog(tableName, recordId, 'UPDATE', oldRow, newRow, orgId || null);
      await this.recordStorage(table, orgId, 'UPDATE', recordId, oldRow, newRow);

      await this.logDbTelemetry('UPDATE', tableName, null, [recordId, payload], newRow, Date.now() - start);
      return newRow;
    } catch (err) {
      await this.logDbTelemetry('UPDATE_FAILED', tableName, null, [recordId, payload], null, Date.now() - start);
      throw err;
    }
  }

  async softDelete(tableName: string, recordId: string): Promise<void> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered(tableName);
      if (table.kind === 'system') {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Tabela de sistema.', 403);
      }
      if (!table.softDelete) {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Tabela não suporta soft delete.', 400);
      }

      const scope = table.kind === 'tenant' ? await this.tenantScope() : { sql: '1=1', params: [] };

      const [oldRows] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT * FROM \`${table.name}\`
         WHERE \`${table.primaryKey}\` = ? AND deleted_at IS NULL AND ${scope.sql}`,
        [recordId, ...scope.params]
      );

      if (!oldRows.length) {
        throw new GatewayError('RECORD_NOT_FOUND', 'Registro não encontrado ou já deletado.', 404);
      }

      const oldRow = { ...oldRows[0] } as Record<string, unknown>;
      const orgId =
        table.kind === 'tenant' ? String(oldRow.organization_id ?? '') : null;

      const [delResult] = await this.connection.execute(
        `UPDATE \`${table.name}\` SET deleted_at = CURRENT_TIMESTAMP
         WHERE \`${table.primaryKey}\` = ? AND deleted_at IS NULL AND ${scope.sql}`,
        [recordId, ...scope.params] as (string | number | boolean | Date | null | Buffer)[]
      );

      const header = delResult as unknown as mysql.ResultSetHeader;
      if (header.affectedRows === 0) {
        throw new GatewayError('RECORD_NOT_FOUND', 'Registro não encontrado ou já deletado.', 404);
      }

      await this.registerAuditLog(
        tableName,
        recordId,
        'SOFT_DELETE',
        oldRow,
        { deleted: true },
        orgId || null
      );
      await this.recordStorage(table, orgId, 'SOFT_DELETE', recordId, oldRow, null);

      await this.logDbTelemetry(
        'SOFT_DELETE',
        tableName,
        null,
        [recordId],
        { affectedRows: header.affectedRows },
        Date.now() - start
      );
    } catch (err) {
      await this.logDbTelemetry(
        'SOFT_DELETE_FAILED',
        tableName,
        null,
        [recordId],
        null,
        Date.now() - start
      );
      throw err;
    }
  }

  async findById(
    tableName: string,
    recordId: string
  ): Promise<Record<string, unknown> | null> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered(tableName);
      if (table.kind === 'system') {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Tabela de sistema.', 403);
      }

      const scope = table.kind === 'tenant' ? await this.tenantScope() : { sql: '1=1', params: [] };
      const softClause = table.softDelete ? ' AND deleted_at IS NULL' : '';

      const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT * FROM \`${table.name}\`
         WHERE \`${table.primaryKey}\` = ? AND ${scope.sql}${softClause}`,
        [recordId, ...scope.params]
      );

      const res = rows.length ? ({ ...rows[0] } as Record<string, unknown>) : null;
      await this.logDbTelemetry('FIND_BY_ID', tableName, null, [recordId], res, Date.now() - start);
      return res;
    } catch (err) {
      await this.logDbTelemetry('FIND_BY_ID_FAILED', tableName, null, [recordId], null, Date.now() - start);
      throw err;
    }
  }

  /** Uso interno: leitura de hodômetro e limites */
  async getOrganizationStorage(organizationId: string): Promise<{
    bytesUsed: number;
    bytesLimit: number | null;
  }> {
    const start = Date.now();
    try {
      let rows: mysql.RowDataPacket[];
      if (this.context.scope === 'node' && this.context.organizationId) {
        const result = await this.connection.query<mysql.RowDataPacket[]>(
          `SELECT o.storage_bytes_used, o.plan_storage_limit_bytes
           FROM organizations o
           INNER JOIN organizations anchor ON anchor.id = ? AND anchor.deleted_at IS NULL
           WHERE o.id = ? AND o.deleted_at IS NULL
             AND (o.path = anchor.path OR o.path LIKE CONCAT(anchor.path, '%'))`,
          [this.context.organizationId, organizationId]
        );
        rows = result[0];
      } else {
        const result = await this.connection.query<mysql.RowDataPacket[]>(
          `SELECT storage_bytes_used, plan_storage_limit_bytes
           FROM organizations
           WHERE id = ? AND deleted_at IS NULL`,
          [organizationId]
        );
        rows = result[0];
      }
      if (!rows.length) {
        throw new GatewayError('ACCESS_DENIED', 'Organização inacessível.', 403);
      }
      const res = {
        bytesUsed: Number(rows[0].storage_bytes_used ?? 0),
        bytesLimit:
          rows[0].plan_storage_limit_bytes != null
            ? Number(rows[0].plan_storage_limit_bytes)
            : null,
      };

      await this.logDbTelemetry(
        'GET_ORG_STORAGE',
        'organizations',
        null,
        [organizationId],
        res,
        Date.now() - start
      );
      return res;
    } catch (err) {
      await this.logDbTelemetry(
        'GET_ORG_STORAGE_FAILED',
        'organizations',
        null,
        [organizationId],
        null,
        Date.now() - start
      );
      throw err;
    }
  }

  async findWhere(
    tableName: string,
    filters: SecurePayload,
    options?: { limit?: number; columns?: string[] }
  ): Promise<Record<string, unknown>[]> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered(tableName);
      if (table.kind === 'system' || table.kind === 'telemetry') {
        throw new GatewayError('TABLE_NOT_ALLOWED', 'Leitura não permitida nesta tabela.', 403);
      }
      if (!Object.keys(filters).length) {
        throw new GatewayError('EMPTY_PAYLOAD', 'Filtros vazios.', 400);
      }

      const scope = table.kind === 'tenant' ? await this.tenantScope() : { sql: '1=1', params: [] };
      const softClause = table.softDelete ? ' AND deleted_at IS NULL' : '';
      const filterKeys = Object.keys(filters);
      const filterClause = filterKeys.map((k) => `\`${k}\` = ?`).join(' AND ');
      const cols =
        options?.columns?.map((c) => `\`${c}\``).join(', ') ?? '*';
      const limit = options?.limit ?? 500;

      const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT ${cols} FROM \`${table.name}\`
         WHERE ${filterClause} AND ${scope.sql}${softClause}
         LIMIT ?`,
        [...this.sanitizeValues(filters), ...scope.params, limit] as (
          | string
          | number
          | boolean
          | Date
          | null
          | Buffer
        )[]
      );

      const mapped = rows.map((r) => ({ ...r }) as Record<string, unknown>);
      await this.logDbTelemetry('FIND_WHERE', tableName, null, [filters, options], mapped, Date.now() - start);
      return mapped;
    } catch (err) {
      await this.logDbTelemetry(
        'FIND_WHERE_FAILED',
        tableName,
        null,
        [filters, options],
        null,
        Date.now() - start
      );
      throw err;
    }
  }

  /**
   * DELETE físico em tabelas de vínculo (allowHardDelete). Somente SYSTEM_INSTALLER.
   * match deve conter todas as colunas da PK composta (ou PK simples).
   */
  async deleteMatching(tableName: string, match: SecurePayload): Promise<number> {
    const start = Date.now();
    try {
      const table = TableRegistry.assertRegistered(tableName);
      if (!table.allowHardDelete) {
        throw new GatewayError(
          'TABLE_NOT_ALLOWED',
          'Hard delete não permitido nesta tabela.',
          403
        );
      }
      if (!this.isInstaller()) {
        throw new GatewayError(
          'ACCESS_DENIED',
          'Hard delete exige contexto SYSTEM_INSTALLER.',
          403
        );
      }

      const pkCols = TableRegistry.getPrimaryKeyColumns(table);
      for (const col of pkCols) {
        if (match[col] == null) {
          throw new GatewayError(
            'EMPTY_PAYLOAD',
            `Chave obrigatória para revogar vínculo: ${col}`,
            400
          );
        }
      }

      const matchKeys = Object.keys(match);
      const whereClause = matchKeys.map((k) => `\`${k}\` = ?`).join(' AND ');
      const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT * FROM \`${table.name}\` WHERE ${whereClause}`,
        this.sanitizeValues(match) as (string | number | boolean | Date | null | Buffer)[]
      );

      let deleted = 0;
      for (const row of rows) {
        const pkWhere = pkCols.map((c) => `\`${c}\` = ?`).join(' AND ');
        const pkParams = pkCols.map((c) => row[c]);
        const [delResult] = await this.connection.execute(
          `DELETE FROM \`${table.name}\` WHERE ${pkWhere}`,
          pkParams as (string | number | boolean | Date | null | Buffer)[]
        );
        const header = delResult as unknown as mysql.ResultSetHeader;
        if (header.affectedRows === 0) {
          continue;
        }
        deleted += header.affectedRows;
        const recordId = TableRegistry.formatRecordId(table, row as Record<string, unknown>);
        const oldRow = { ...row } as Record<string, unknown>;
        await this.registerAuditLog(tableName, recordId, 'DELETE', oldRow, null, null);
      }

      await this.logDbTelemetry(
        'DELETE_MATCHING',
        tableName,
        null,
        [match],
        { affectedRows: deleted },
        Date.now() - start
      );
      return deleted;
    } catch (err) {
      await this.logDbTelemetry(
        'DELETE_MATCHING_FAILED',
        tableName,
        null,
        [match],
        null,
        Date.now() - start
      );
      throw err;
    }
  }

  async readQuery(
    queryKey: GatewayReadQueryKey,
    params: unknown[] = []
  ): Promise<Record<string, unknown>[]> {
    const start = Date.now();
    try {
      const def = GATEWAY_READ_QUERIES[queryKey];
      if (!def) {
        throw new GatewayError('TABLE_NOT_ALLOWED', `Consulta não registrada: ${queryKey}`, 400);
      }
      if (def.requiresGlobalScope && this.context.scope !== 'global') {
        throw new GatewayError(
          'ACCESS_DENIED',
          'Consulta restrita ao escopo global da plataforma.',
          403
        );
      }
      if (def.bootstrapOnly && !this.isInstaller()) {
        throw new GatewayError(
          'ACCESS_DENIED',
          'Consulta restrita ao contexto SYSTEM_INSTALLER.',
          403
        );
      }

      const [rows] = await this.connection.query<mysql.RowDataPacket[]>(def.sql, params);
      const mapped = rows.map((r) => ({ ...r }) as Record<string, unknown>);

      await this.logDbTelemetry('READ_QUERY', null, queryKey, params, mapped, Date.now() - start);
      return mapped;
    } catch (err) {
      await this.logDbTelemetry('READ_QUERY_FAILED', null, queryKey, params, null, Date.now() - start);
      throw err;
    }
  }
}
