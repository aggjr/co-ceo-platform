import mysql from 'mysql2/promise';
import { GatewayError } from './errors';
import { GatewayRepository } from './GatewayRepository';
import { TableRegistry } from './TableRegistry';
import type { GatewayReadQueryKey } from './GatewayReadQueries';
import type { InsertResult, SecurePayload, UserContext } from './types';
import type { TelemetryEventInput, TelemetryIngestMeta } from '../telemetry/types';

export type { UserContext, SecurePayload, InsertResult } from './types';
export { GatewayError } from './errors';
export { SYSTEM_INSTALLER_USER_ID } from './types';

/**
 * Único ponto de entrada para mutações e leituras de negócio no MySQL.
 * Garante: whitelist de tabelas, isolamento hierárquico, audit na transação,
 * soft delete, hodômetro de storage e rastreio de impersonation.
 */
export class CoCeoDataGateway {
  constructor(private readonly pool: mysql.Pool) {}

  /**
   * Executa operação em transação ACID (dado + audit + hodômetro).
   */
  async transaction<T>(
    context: UserContext,
    operation: (repo: GatewayRepository) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    try {
      const repo = new GatewayRepository(connection, context);
      const result = await operation(repo);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async insert(
    context: UserContext,
    tableName: string,
    payload: SecurePayload
  ): Promise<InsertResult> {
    return this.transaction(context, (repo) => repo.insert(tableName, payload));
  }

  /** Append-only: uso de telas e ações (identidade vem do JWT, não do cliente). */
  async recordTelemetryEvents(
    context: UserContext,
    events: TelemetryEventInput[],
    meta: TelemetryIngestMeta
  ): Promise<void> {
    if (!events.length) {
      return;
    }
    return this.transaction(context, (repo) => repo.insertTelemetryBatch(events, meta));
  }

  async update(
    context: UserContext,
    tableName: string,
    recordId: string,
    payload: SecurePayload
  ): Promise<Record<string, unknown>> {
    return this.transaction(context, (repo) => repo.update(tableName, recordId, payload));
  }

  async softDelete(context: UserContext, tableName: string, recordId: string): Promise<void> {
    return this.transaction(context, (repo) => repo.softDelete(tableName, recordId));
  }

  async findById(
    context: UserContext,
    tableName: string,
    recordId: string
  ): Promise<Record<string, unknown> | null> {
    TableRegistry.assertRegistered(tableName);
    const connection = await this.pool.getConnection();
    try {
      const repo = new GatewayRepository(connection, context);
      return await repo.findById(tableName, recordId);
    } finally {
      connection.release();
    }
  }

  async getOrganizationStorage(
    context: UserContext,
    organizationId: string
  ): Promise<{ bytesUsed: number; bytesLimit: number | null }> {
    const connection = await this.pool.getConnection();
    try {
      const repo = new GatewayRepository(connection, context);
      return await repo.getOrganizationStorage(organizationId);
    } finally {
      connection.release();
    }
  }

  async findWhere(
    context: UserContext,
    tableName: string,
    filters: SecurePayload,
    options?: { limit?: number; columns?: string[] }
  ): Promise<Record<string, unknown>[]> {
    const connection = await this.pool.getConnection();
    try {
      const repo = new GatewayRepository(connection, context);
      return await repo.findWhere(tableName, filters, options);
    } finally {
      connection.release();
    }
  }

  async deleteMatching(
    context: UserContext,
    tableName: string,
    match: SecurePayload
  ): Promise<number> {
    return this.transaction(context, (repo) => repo.deleteMatching(tableName, match));
  }

  async readQuery(
    context: UserContext,
    queryKey: GatewayReadQueryKey,
    params: unknown[] = []
  ): Promise<Record<string, unknown>[]> {
    const connection = await this.pool.getConnection();
    try {
      const repo = new GatewayRepository(connection, context);
      return await repo.readQuery(queryKey, params);
    } finally {
      connection.release();
    }
  }
}

/**
 * @deprecated Use CoCeoDataGateway
 */
export const DataWrapper = CoCeoDataGateway;
