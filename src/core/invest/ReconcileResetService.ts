import type { CoCeoDataGateway, UserContext } from '../dal';
import type mysql from 'mysql2/promise';
import pool from '../../config/database';

type PoolConnection = mysql.PoolConnection;



/**
 * ReconcileResetService
 *
 * Apaga todos os dados operacionais de uma organização, preservando:
 * - Usuários, organizações, contratos, permissões (tabelas de sistema)
 * - Lançamentos de inicialização (opening_balance) em todas as tabelas
 *
 * Ao final, zera o odômetro de storage para que o cliente parta do zero.
 */
export class ReconcileResetService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Executa o reset completo. Retorna um relatório de limpeza.
   */
  async resetHolding(ctx: UserContext): Promise<ResetReport> {
    const orgId = ctx.organizationId;
    if (!orgId) throw new Error('Organização obrigatória para reset.');

    const report: ResetReport = {
      orgId,
      steps: [],
      deletedCounts: {},
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Desativa FKs temporariamente para permitir deleção sem ordem rígida
      await conn.query('SET foreign_key_checks = 0');

      // ── Etapa 1: Identificar IDs de opening_balance a preservar ────────────
      const [openingPatrimonyRows] = await conn.query<any[]>(
        `SELECT id FROM patrimony_ledger_entries
         WHERE organization_id = ? AND transaction_type = 'opening_balance'`,
        [orgId]
      );
      const preservedPatrimonyIds = openingPatrimonyRows.map((r: any) => r.id);

      const [openingFinancialRows] = await conn.query<any[]>(
        `SELECT id FROM financial_ledger_entries
         WHERE organization_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'opening_balance'`,
        [orgId]
      );
      const preservedFinancialIds = openingFinancialRows.map((r: any) => r.id);

      const [openingEventRows] = await conn.query<any[]>(
        `SELECT id FROM business_events
         WHERE organization_id = ? AND event_kind = 'opening_balance'`,
        [orgId]
      );
      const preservedEventIds = openingEventRows.map((r: any) => r.id);

      report.steps.push({
        step: 'identify_opening',
        detail: `Preservando: ${preservedPatrimonyIds.length} ledger patrimônio, ${preservedFinancialIds.length} ledger financeiro, ${preservedEventIds.length} business events`,
      });

      // ── Etapa 2: Limpar tabelas derivadas de investimento ─────────────────
      await this.deleteByOrg(conn, report, 'invest_broker_custody_snapshot_lines',
        `snapshot_id IN (SELECT id FROM invest_broker_custody_snapshots WHERE organization_id = ?)`, [orgId]);

      await this.deleteByOrg(conn, report, 'invest_broker_custody_snapshots',
        `organization_id = ?`, [orgId]);

      await this.deleteByOrg(conn, report, 'invest_portfolio_daily',
        `organization_id = ?`, [orgId]);

      await this.deleteByOrg(conn, report, 'invest_daily_snapshots',
        `organization_id = ?`, [orgId]);

      await this.deleteByOrg(conn, report, 'invest_patrimony_monthly_anchors',
        `organization_id = ?`, [orgId]);

      // invest_position_ext e invest_option_ext vinculados via patrimony_item_id
      await this.deleteByOrg(conn, report, 'invest_position_ext',
        `organization_id = ?`, [orgId]);

      await this.deleteByOrg(conn, report, 'invest_option_ext',
        `patrimony_item_id IN (SELECT id FROM patrimony_items WHERE organization_id = ?)`, [orgId]);

      await this.deleteByOrg(conn, report, 'patrimony_closings',
        `organization_id = ?`, [orgId]);

      await this.deleteByOrg(conn, report, 'financial_closings',
        `organization_id = ?`, [orgId]);

      // ── Etapa 3: Limpar ledgers financeiros (exceto opening_balance) ──────
      if (preservedFinancialIds.length > 0) {
        const placeholders = preservedFinancialIds.map(() => '?').join(',');
        const [res] = await conn.query<any>(
          `DELETE FROM financial_ledger_entries WHERE organization_id = ? AND id NOT IN (${placeholders})`,
          [orgId, ...preservedFinancialIds]
        );
        report.deletedCounts['financial_ledger_entries'] = res.affectedRows;
        report.steps.push({ step: 'delete_financial_ledger', detail: `${res.affectedRows} entradas deletadas` });
      } else {
        const [res] = await conn.query<any>(
          `DELETE FROM financial_ledger_entries WHERE organization_id = ?`,
          [orgId]
        );
        report.deletedCounts['financial_ledger_entries'] = res.affectedRows;
        report.steps.push({ step: 'delete_financial_ledger', detail: `${res.affectedRows} entradas deletadas` });
      }

      // ── Etapa 4: Limpar ledgers de patrimônio (exceto opening_balance) ────
      if (preservedPatrimonyIds.length > 0) {
        const placeholders = preservedPatrimonyIds.map(() => '?').join(',');
        const [res] = await conn.query<any>(
          `DELETE FROM patrimony_ledger_entries WHERE organization_id = ? AND id NOT IN (${placeholders})`,
          [orgId, ...preservedPatrimonyIds]
        );
        report.deletedCounts['patrimony_ledger_entries'] = res.affectedRows;
        report.steps.push({ step: 'delete_patrimony_ledger', detail: `${res.affectedRows} entradas deletadas` });
      } else {
        const [res] = await conn.query<any>(
          `DELETE FROM patrimony_ledger_entries WHERE organization_id = ?`,
          [orgId]
        );
        report.deletedCounts['patrimony_ledger_entries'] = res.affectedRows;
        report.steps.push({ step: 'delete_patrimony_ledger', detail: `${res.affectedRows} entradas deletadas` });
      }

      // ── Etapa 5: Limpar patrimony_items sem ledger entries restantes ──────
      // (mantém itens com opening_balance)
      const [res5] = await conn.query<any>(
        `DELETE FROM patrimony_items
         WHERE organization_id = ?
           AND id NOT IN (
             SELECT DISTINCT patrimony_item_id FROM patrimony_ledger_entries
             WHERE organization_id = ? AND patrimony_item_id IS NOT NULL
           )`,
        [orgId, orgId]
      );
      report.deletedCounts['patrimony_items'] = res5.affectedRows;
      report.steps.push({ step: 'delete_patrimony_items', detail: `${res5.affectedRows} itens deletados` });

      // ── Etapa 6: Limpar financial_accounts sem ledger entries restantes ───
      const [res6] = await conn.query<any>(
        `DELETE FROM financial_accounts
         WHERE organization_id = ?
           AND id NOT IN (
             SELECT DISTINCT account_id FROM financial_ledger_entries
             WHERE organization_id = ? AND account_id IS NOT NULL
           )`,
        [orgId, orgId]
      );
      report.deletedCounts['financial_accounts'] = res6.affectedRows;
      report.steps.push({ step: 'delete_financial_accounts', detail: `${res6.affectedRows} contas deletadas` });

      // ── Etapa 7: Limpar business_events (exceto opening_balance) ─────────
      if (preservedEventIds.length > 0) {
        const placeholders = preservedEventIds.map(() => '?').join(',');
        const [res7] = await conn.query<any>(
          `DELETE FROM business_events WHERE organization_id = ? AND id NOT IN (${placeholders})`,
          [orgId, ...preservedEventIds]
        );
        report.deletedCounts['business_events'] = res7.affectedRows;
        report.steps.push({ step: 'delete_business_events', detail: `${res7.affectedRows} eventos deletados` });
      } else {
        const [res7] = await conn.query<any>(
          `DELETE FROM business_events WHERE organization_id = ?`,
          [orgId]
        );
        report.deletedCounts['business_events'] = res7.affectedRows;
        report.steps.push({ step: 'delete_business_events', detail: `${res7.affectedRows} eventos deletados` });
      }

      // ── Etapa 8: Zerar odômetro de storage ────────────────────────────────
      const [res8] = await conn.query<any>(
        `DELETE FROM organization_storage_ledger WHERE organization_id = ?`,
        [orgId]
      );
      report.deletedCounts['organization_storage_ledger'] = res8.affectedRows;
      report.steps.push({ step: 'reset_storage_odometer', detail: `Odômetro zerado (${res8.affectedRows} linha(s))` });

      await conn.query('SET foreign_key_checks = 1');
      await conn.commit();

      report.steps.push({ step: 'complete', detail: 'Reset concluído com sucesso. Pronto para reimportar.' });
      return report;
    } catch (err) {
      await conn.rollback();
      await conn.query('SET foreign_key_checks = 1');
      throw err;
    } finally {
      conn.release();
    }
  }

  private async deleteByOrg(
    conn: PoolConnection,
    report: ResetReport,
    table: string,
    whereClause: string,
    params: unknown[]
  ) {
    const [res] = await conn.query<any>(
      `DELETE FROM ${table} WHERE ${whereClause}`,
      params
    );
    report.deletedCounts[table] = res.affectedRows;
    report.steps.push({ step: `delete_${table}`, detail: `${res.affectedRows} registros deletados` });
  }
}

export interface ResetReport {
  orgId: string;
  steps: Array<{ step: string; detail: string }>;
  deletedCounts: Record<string, number>;
}
