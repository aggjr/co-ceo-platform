import { Request, Response } from 'express';
import pool from '../config/database';
import path from 'path';
import fs from 'fs';
import { StorageMeter } from '../core/dal/StorageMeter';

export class RemoteMigrationController {
  constructor(private gateway: any) {}

  public runMigration = async (req: Request, res: Response): Promise<Response> => {
    const conn = await pool.getConnection();
    try {
      console.log('[RemoteMigration] Iniciando migracao interna via Seed JSON...');
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: 'Falta orgId' });
      }

      const seedPath = path.resolve(__dirname, '../database/seeds/invest_migration.json');
      if (!fs.existsSync(seedPath)) {
        return res.status(400).json({ error: 'Arquivo invest_migration.json nao encontrado' });
      }

      const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
      const tables = [
        'financial_ledger_entries',
        'patrimony_ledger_entries',
        'invest_position_ext',
        'patrimony_items',
        'invest_portfolio_daily',
        'invest_patrimony_monthly_anchors',
      ];

      await conn.beginTransaction();

      console.log('[RemoteMigration] Limpando tabelas alvo...');
      for (const table of tables) {
        await conn.query(`DELETE FROM ?? WHERE organization_id=?`, [table, orgId]);
      }

      for (const table of tables) {
        const rows = data[table] || [];
        if (rows.length === 0) continue;
        console.log(`[RemoteMigration] Inserindo ${rows.length} registros em ${table}...`);

        for (const row of rows) {
          const keys = Object.keys(row);
          const values = Object.values(row).map((value) => {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
              return value.replace('T', ' ').replace('Z', '');
            }
            return value;
          });
          const placeholders = keys.map(() => '?').join(', ');

          await conn.query(
            `INSERT INTO ?? (${keys.join(', ')}) VALUES (${placeholders})`,
            [table, ...values]
          );
        }
      }

      const storage = await StorageMeter.recalculateOrganizationUsage(conn, orgId);
      await conn.commit();

      console.log('[RemoteMigration] Concluido com sucesso!');
      return res.json({
        success: true,
        message: 'Migracao concluida com sucesso!',
        storageBytesBefore: storage.previousBytes,
        storageBytesAfter: storage.recalculatedBytes,
      });
    } catch (error: any) {
      await conn.rollback();
      console.error('[RemoteMigration] Erro:', error);
      return res.status(500).json({ error: error.message });
    } finally {
      conn.release();
    }
  };
}
