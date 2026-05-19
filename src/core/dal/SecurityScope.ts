import mysql from 'mysql2/promise';
import { GatewayError } from './errors';
import type { UserContext } from './types';

/** Materialized path: segmentos alfanuméricos separados por / */
const PATH_RE = /^(\/[a-zA-Z0-9_-]+)+\/?$/;

export interface ScopeClause {
  sql: string;
  params: unknown[];
}

export class SecurityScopeResolver {
  /**
   * Valida formato do path para evitar metacaracteres em LIKE.
   */
  static validatePath(path: string): void {
    if (!PATH_RE.test(path)) {
      throw new GatewayError('INVALID_PATH', 'Path de organização em formato inválido.', 500);
    }
  }

  static async resolvePathPrefix(
    executor: mysql.Pool | mysql.Connection,
    organizationId: string
  ): Promise<string> {
    const [rows] = await executor.query<mysql.RowDataPacket[]>(
      'SELECT path FROM organizations WHERE id = ? AND deleted_at IS NULL',
      [organizationId]
    );
    if (!rows.length) {
      throw new GatewayError('ORG_NOT_FOUND', 'Organização não encontrada.', 404);
    }
    const path = String(rows[0].path);
    SecurityScopeResolver.validatePath(path);
    return path.endsWith('/') ? path : `${path}/`;
  }

  /**
   * Cláusula parametrizada para filtrar organization_id na sub-árvore do nó.
   */
  static buildTenantScopeClause(context: UserContext, pathPrefix: string | null): ScopeClause {
    if (context.scope === 'global' || !pathPrefix) {
      return { sql: '1=1', params: [] };
    }
    SecurityScopeResolver.validatePath(pathPrefix);
    const likePattern = `${pathPrefix}%`;
    return {
      sql: `organization_id IN (
        SELECT id FROM organizations
        WHERE deleted_at IS NULL AND path LIKE ?
      )`,
      params: [likePattern],
    };
  }
}
