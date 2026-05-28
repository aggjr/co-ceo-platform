import { Request, Response } from 'express';
import pool from '../config/database';
import path from 'path';
import fs from 'fs';

export class RemoteMigrationController {
  constructor(private gateway: any) {}

  public runMigration = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log('[RemoteMigration] Iniciando migração interna via Seed JSON...');
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: 'Falta orgId' });
      }

      const seedPath = path.resolve(__dirname, '../database/seeds/invest_migration.json');
      if (!fs.existsSync(seedPath)) {
        return res.status(400).json({ error: 'Arquivo invest_migration.json não encontrado' });
      }

      const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

      const tables = [
        'financial_ledger_entries',
        'patrimony_ledger_entries',
        'invest_position_ext',
        'patrimony_items',
        'invest_portfolio_daily',
        'invest_patrimony_monthly_anchors'
      ];

      console.log('[RemoteMigration] Limpando tabelas alvo...');
      for (const table of tables) {
        await pool.query(`DELETE FROM ?? WHERE organization_id=?`, [table, orgId]);
      }

      for (const table of tables) {
        const rows = data[table] || [];
        if (rows.length === 0) continue;
        console.log(`[RemoteMigration] Inserindo ${rows.length} registros em ${table}...`);
        
        for (const row of rows) {
          const keys = Object.keys(row);
          const values = Object.values(row);
          
          // Formatar datas para o MySQL (remover o Z do ISO string)
          const formattedValues = values.map(v => {
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
              return v.replace('T', ' ').replace('Z', '');
            }
            return v;
          });

          const placeholders = keys.map(() => '?').join(', ');
          
          await pool.query(
            `INSERT INTO ?? (${keys.join(', ')}) VALUES (${placeholders})`,
            [table, ...formattedValues]
          );
        }
      }

      console.log('[RemoteMigration] Concluído com sucesso!');
      return res.json({ success: true, message: 'Migração concluída com sucesso!' });

    } catch (error: any) {
      console.error('[RemoteMigration] Erro:', error);
      return res.status(500).json({ error: error.message });
    }
  };
}
