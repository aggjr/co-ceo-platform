import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { StorageMeter } from '../dal/StorageMeter';

type ResetStep = {
  step: string;
  affectedRows: number;
};

export type HoldingFullResetResult = {
  orgId: string;
  deleted: ResetStep[];
  storageBytesBefore: number;
  storageBytesAfter: number;
};

const DELETE_STEPS = [
  {
    name: 'invest_broker_custody_snapshot_lines',
    sql: 'DELETE FROM invest_broker_custody_snapshot_lines WHERE organization_id = ?',
  },
  {
    name: 'invest_broker_custody_snapshots',
    sql: 'DELETE FROM invest_broker_custody_snapshots WHERE organization_id = ?',
  },
  { name: 'invest_reconciliation_day_log', sql: 'DELETE FROM invest_reconciliation_day_log WHERE organization_id = ?' },
  { name: 'invest_reconciliation_sessions', sql: 'DELETE FROM invest_reconciliation_sessions WHERE organization_id = ?' },
  { name: 'invest_portfolio_daily', sql: 'DELETE FROM invest_portfolio_daily WHERE organization_id = ?' },
  { name: 'invest_position_daily', sql: 'DELETE FROM invest_position_daily WHERE organization_id = ?' },
  { name: 'invest_daily_snapshots', sql: 'DELETE FROM invest_daily_snapshots WHERE organization_id = ?' },
  {
    name: 'invest_patrimony_monthly_anchors',
    sql: 'DELETE FROM invest_patrimony_monthly_anchors WHERE organization_id = ?',
  },
  { name: 'patrimony_closings', sql: 'DELETE FROM patrimony_closings WHERE organization_id = ?' },
  { name: 'financial_closings', sql: 'DELETE FROM financial_closings WHERE organization_id = ?' },
  { name: 'invest_cash_account_bindings', sql: 'DELETE FROM invest_cash_account_bindings WHERE organization_id = ?' },
  { name: 'invest_option_ext', sql: 'DELETE FROM invest_option_ext WHERE organization_id = ?' },
  { name: 'invest_position_ext', sql: 'DELETE FROM invest_position_ext WHERE organization_id = ?' },
  {
    name: 'patrimony_item_locations',
    sql: `DELETE pil FROM patrimony_item_locations pil
          INNER JOIN patrimony_items pi ON pi.id = pil.patrimony_item_id
          WHERE pi.organization_id = ?`,
  },
  { name: 'financial_ledger_entries', sql: 'DELETE FROM financial_ledger_entries WHERE organization_id = ?' },
  { name: 'patrimony_ledger_entries', sql: 'DELETE FROM patrimony_ledger_entries WHERE organization_id = ?' },
  { name: 'business_events', sql: 'DELETE FROM business_events WHERE organization_id = ?' },
  { name: 'financial_accounts', sql: 'DELETE FROM financial_accounts WHERE organization_id = ?' },
  { name: 'patrimony_items', sql: 'DELETE FROM patrimony_items WHERE organization_id = ?' },
] as const;

/**
 * Reset operacional completo do livro INVEST de uma organizacao.
 *
 * Este e um servico de manutencao oficial: usa DELETE direto apenas porque o
 * objetivo e apagar/remapear um livro inteiro. Por isso, sempre roda em
 * transacao e recalcula o hodometro antes do commit.
 */
export class HoldingFullResetService {
  constructor(private readonly pool: Pool) {}

  async reset(ctx: UserContext, reason: string): Promise<HoldingFullResetResult> {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organizacao obrigatoria para reset.', 400);
    }
    if (!reason.trim()) {
      throw new GatewayError('INVALID_PAYLOAD', 'Informe o motivo do reset completo.', 400);
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await this.clearCrossLinks(conn, orgId);

      const deleted: ResetStep[] = [];
      for (const step of DELETE_STEPS) {
        deleted.push({
          step: step.name,
          affectedRows: await this.deleteOrgRows(conn, step.sql, orgId),
        });
      }

      const storage = await StorageMeter.recalculateOrganizationUsage(conn, orgId);
      await conn.commit();

      return {
        orgId,
        deleted,
        storageBytesBefore: storage.previousBytes,
        storageBytesAfter: storage.recalculatedBytes,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  private async clearCrossLinks(conn: PoolConnection, orgId: string): Promise<void> {
    await conn.query(
      `UPDATE patrimony_ledger_entries
       SET related_financial_entry_id = NULL
       WHERE organization_id = ? AND related_financial_entry_id IS NOT NULL`,
      [orgId]
    );
    await conn.query(
      `UPDATE financial_ledger_entries
       SET related_patrimony_ledger_id = NULL
       WHERE organization_id = ? AND related_patrimony_ledger_id IS NOT NULL`,
      [orgId]
    );
  }

  private async deleteOrgRows(
    conn: PoolConnection,
    sql: string,
    orgId: string
  ): Promise<number> {
    const [res] = await conn.query<ResultSetHeader>(sql, [orgId]);
    return res.affectedRows;
  }
}
