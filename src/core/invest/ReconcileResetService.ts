import type { CoCeoDataGateway, UserContext } from '../dal';
import type mysql from 'mysql2/promise';
import pool from '../../config/database';
import { StorageMeter } from '../dal/StorageMeter';
import { clearLedgerCrossLinksByPreservedIds } from './ledgerPurgeCrossLinks';

type PoolConnection = mysql.PoolConnection;

/**
 * Apaga dados operacionais de uma organizacao, preservando entidades de
 * sistema e lancamentos de abertura. Como usa DELETE direto, o hodometro de
 * storage precisa ser recalculado ao final da transacao.
 */
export class ReconcileResetService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async resetHolding(ctx: UserContext): Promise<ResetReport> {
    const orgId = ctx.organizationId;
    if (!orgId) throw new Error('Organizacao obrigatoria para reset.');

    const report: ResetReport = {
      orgId,
      steps: [],
      deletedCounts: {},
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SET foreign_key_checks = 0');

      const [openingPatrimonyRows] = await conn.query<any[]>(
        `SELECT id FROM patrimony_ledger_entries
         WHERE organization_id = ? AND movement_type = 'opening_balance'`,
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
        detail: `Preservando: ${preservedPatrimonyIds.length} ledger patrimonio, ${preservedFinancialIds.length} ledger financeiro, ${preservedEventIds.length} business events`,
      });

      await this.deleteByOrg(
        conn,
        report,
        'invest_broker_custody_snapshot_lines',
        `snapshot_id IN (SELECT id FROM invest_broker_custody_snapshots WHERE organization_id = ?)`,
        [orgId]
      );
      await this.deleteByOrg(conn, report, 'invest_broker_custody_snapshots', `organization_id = ?`, [orgId]);
      await this.deleteByOrg(conn, report, 'invest_portfolio_daily', `organization_id = ?`, [orgId]);
      await this.deleteByOrg(conn, report, 'invest_daily_snapshots', `organization_id = ?`, [orgId]);
      await this.deleteByOrg(conn, report, 'invest_position_ext', `organization_id = ?`, [orgId]);
      await this.deleteByOrg(
        conn,
        report,
        'invest_option_ext',
        `patrimony_item_id IN (SELECT id FROM patrimony_items WHERE organization_id = ?)`,
        [orgId]
      );
      await this.deleteByOrg(conn, report, 'patrimony_closings', `organization_id = ?`, [orgId]);
      await this.deleteByOrg(conn, report, 'financial_closings', `organization_id = ?`, [orgId]);

      const unlinked = await clearLedgerCrossLinksByPreservedIds(
        conn,
        orgId,
        preservedFinancialIds,
        preservedPatrimonyIds
      );
      report.steps.push({
        step: 'unlink_ledger_cross_refs',
        detail: `ple/fle desvinculados: ${unlinked.pleUnlinked} + ${unlinked.fleUnlinked}`,
      });

      if (preservedFinancialIds.length > 0) {
        const placeholders = preservedFinancialIds.map(() => '?').join(',');
        const [res] = await conn.query<any>(
          `DELETE FROM financial_ledger_entries WHERE organization_id = ? AND id NOT IN (${placeholders})`,
          [orgId, ...preservedFinancialIds]
        );
        report.deletedCounts.financial_ledger_entries = res.affectedRows;
        report.steps.push({ step: 'delete_financial_ledger', detail: `${res.affectedRows} entradas deletadas` });
      } else {
        const [res] = await conn.query<any>(
          `DELETE FROM financial_ledger_entries WHERE organization_id = ?`,
          [orgId]
        );
        report.deletedCounts.financial_ledger_entries = res.affectedRows;
        report.steps.push({ step: 'delete_financial_ledger', detail: `${res.affectedRows} entradas deletadas` });
      }

      if (preservedPatrimonyIds.length > 0) {
        const placeholders = preservedPatrimonyIds.map(() => '?').join(',');
        const [res] = await conn.query<any>(
          `DELETE FROM patrimony_ledger_entries WHERE organization_id = ? AND id NOT IN (${placeholders})`,
          [orgId, ...preservedPatrimonyIds]
        );
        report.deletedCounts.patrimony_ledger_entries = res.affectedRows;
        report.steps.push({ step: 'delete_patrimony_ledger', detail: `${res.affectedRows} entradas deletadas` });
      } else {
        const [res] = await conn.query<any>(
          `DELETE FROM patrimony_ledger_entries WHERE organization_id = ?`,
          [orgId]
        );
        report.deletedCounts.patrimony_ledger_entries = res.affectedRows;
        report.steps.push({ step: 'delete_patrimony_ledger', detail: `${res.affectedRows} entradas deletadas` });
      }

      const [res5] = await conn.query<any>(
        `DELETE FROM patrimony_items
         WHERE organization_id = ?
           AND id NOT IN (
             SELECT DISTINCT patrimony_item_id FROM patrimony_ledger_entries
             WHERE organization_id = ? AND patrimony_item_id IS NOT NULL
           )`,
        [orgId, orgId]
      );
      report.deletedCounts.patrimony_items = res5.affectedRows;
      report.steps.push({ step: 'delete_patrimony_items', detail: `${res5.affectedRows} itens deletados` });

      const [res6] = await conn.query<any>(
        `DELETE FROM financial_accounts
         WHERE organization_id = ?
           AND id NOT IN (
             SELECT DISTINCT account_id FROM financial_ledger_entries
             WHERE organization_id = ? AND account_id IS NOT NULL
           )`,
        [orgId, orgId]
      );
      report.deletedCounts.financial_accounts = res6.affectedRows;
      report.steps.push({ step: 'delete_financial_accounts', detail: `${res6.affectedRows} contas deletadas` });

      if (preservedEventIds.length > 0) {
        const placeholders = preservedEventIds.map(() => '?').join(',');
        const [res7] = await conn.query<any>(
          `DELETE FROM business_events WHERE organization_id = ? AND id NOT IN (${placeholders})`,
          [orgId, ...preservedEventIds]
        );
        report.deletedCounts.business_events = res7.affectedRows;
        report.steps.push({ step: 'delete_business_events', detail: `${res7.affectedRows} eventos deletados` });
      } else {
        const [res7] = await conn.query<any>(
          `DELETE FROM business_events WHERE organization_id = ?`,
          [orgId]
        );
        report.deletedCounts.business_events = res7.affectedRows;
        report.steps.push({ step: 'delete_business_events', detail: `${res7.affectedRows} eventos deletados` });
      }

      const storage = await StorageMeter.recalculateOrganizationUsage(conn, orgId);
      report.storageBytesBefore = storage.previousBytes;
      report.storageBytesAfter = storage.recalculatedBytes;
      report.steps.push({
        step: 'recalculate_storage_odometer',
        detail: `Odometro recalculado: ${storage.previousBytes} -> ${storage.recalculatedBytes} bytes (${storage.tablesScanned} tabela(s))`,
      });

      await conn.query('SET foreign_key_checks = 1');
      await conn.commit();

      report.steps.push({ step: 'complete', detail: 'Reset concluido com sucesso. Pronto para reimportar.' });
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
  storageBytesBefore?: number;
  storageBytesAfter?: number;
}
