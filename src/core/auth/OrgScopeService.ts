import pool from '../../config/database';
import { RowDataPacket } from 'mysql2';

export class OrgScopeService {
  /** Verifica se targetOrg está na subárvore de actorOrg (inclusive). */
  static async assertOrgInSubtree(actorOrgId: string, targetOrgId: string): Promise<void> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.path AS actor_path, t.path AS target_path
       FROM organizations a
       INNER JOIN organizations t ON t.id = ?
       WHERE a.id = ? AND a.deleted_at IS NULL AND t.deleted_at IS NULL`,
      [targetOrgId, actorOrgId]
    );
    if (!rows.length) {
      throw Object.assign(new Error('Organização inacessível.'), { httpStatus: 403 });
    }
    const actorPath = String(rows[0].actor_path);
    const targetPath = String(rows[0].target_path);
    if (!targetPath.startsWith(actorPath)) {
      throw Object.assign(new Error('Fora do escopo da sua unidade de negócio.'), { httpStatus: 403 });
    }
  }

  static async getPathPrefix(organizationId: string): Promise<string> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT path FROM organizations WHERE id = ? AND deleted_at IS NULL`,
      [organizationId]
    );
    if (!rows.length) {
      throw Object.assign(new Error('Organização não encontrada.'), { httpStatus: 404 });
    }
    return String(rows[0].path);
  }
}
