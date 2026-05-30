import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { StorageMeter } from '../dal/StorageMeter';
import {
  reconcileActivity,
  type ReconcileActivityStep,
} from './reconcile/reconcileActivity';
import { logReconcileFailure } from './reconcile/reconcileErrorDetail';
import { LedgerImportService } from './LedgerImportService';
import { resolveInvestPeriodBounds } from './investPeriodBounds';
import {
  clearLedgerCrossLinksForOpeningPurge,
  deleteOrphanPatrimonyItemDependents,
} from './ledgerPurgeCrossLinks';

const AUX_ORG_TABLES = [
  'patrimony_closings',
  'financial_closings',
  'invest_broker_custody_snapshot_lines',
  'invest_broker_custody_snapshots',
  'invest_portfolio_daily',
  'invest_daily_snapshots',
  'invest_ledger_entries',
  'invest_assets',
  'invest_reconciliation_day_log',
  'invest_reconciliation_sessions',
] as const;

export type HoldingPurgePreview = {
  openingDate: string;
  openingRef: string;
  openingEventIds: string[];
  openingLegCount: number;
  patrimonyLegsToRemove: number;
  financialLegsToRemove: number;
  businessEventsToRemove: number;
  auxRowsToRemove: Record<string, number>;
  canPurge: boolean;
  abortReason?: string;
};

export type HoldingPurgeResult = HoldingPurgePreview & {
  executed: true;
  patrimonyLegsRemoved: number;
  financialLegsRemoved: number;
  businessEventsRemoved: number;
  storageBytesBefore: number;
  storageBytesAfter: 0;
  activityLog: ReconcileActivityStep[];
  reconcileCustody: unknown;
};

export type ReconcilePreflightResult = {
  needsDataModeChoice: boolean;
  openingDate: string | null;
  openingRef: string | null;
  openingLegCount: number;
  purgePreview: HoldingPurgePreview | null;
};

export class HoldingPurgeKeepOpeningService {
  private readonly ledger: LedgerImportService;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly pool: Pool
  ) {
    this.ledger = new LedgerImportService(gateway);
  }

  async preflight(ctx: UserContext): Promise<ReconcilePreflightResult> {
    const orgId = this.requireOrg(ctx);
    const bounds = await this.openingBounds(ctx);
    const preview = await this.buildPreview(orgId, bounds.openingDate, bounds.openingRef);

    const hasBeyondOpening =
      preview.patrimonyLegsToRemove > 0 ||
      preview.financialLegsToRemove > 0 ||
      Object.values(preview.auxRowsToRemove).some((n) => n > 0);

    return {
      needsDataModeChoice: hasBeyondOpening,
      openingDate: bounds.openingDate,
      openingRef: bounds.openingRef,
      openingLegCount: preview.openingLegCount,
      purgePreview: hasBeyondOpening ? preview : null,
    };
  }

  async purgeKeepOpening(ctx: UserContext): Promise<HoldingPurgeResult> {
    const orgId = this.requireOrg(ctx);
    const bounds = await this.openingBounds(ctx);
    const preview = await this.buildPreview(orgId, bounds.openingDate, bounds.openingRef);

    if (!preview.canPurge) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        preview.abortReason || 'Abertura não encontrada — purge cancelado.',
        422
      );
    }

    const activityLog: ReconcileActivityStep[] = [];
    const log = (message: string, command: string, level?: ReconcileActivityStep['level']) => {
      activityLog.push(reconcileActivity(orgId, message, { command, level }));
    };

    log(`Início purge — abertura ${bounds.openingDate}`, 'purge.start');
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const executed = await this.executePurgeOnConnection(
        conn,
        orgId,
        bounds.openingDate,
        bounds.openingRef,
        preview.openingEventIds,
        log
      );
      const storageReset = await StorageMeter.resetOrganizationUsage(conn, orgId);
      await conn.commit();
      log(
        `Purge concluído — storage ${storageReset.previousBytes} → 0 bytes`,
        'purge.done',
        'ok'
      );

      const reconcileCustody = await this.ledger.reconcileCustody(ctx);
      log('Custódia reconciliada após purge', 'custody.reconcile', 'ok');

      return {
        ...preview,
        executed: true,
        ...executed,
        storageBytesBefore: storageReset.previousBytes,
        storageBytesAfter: 0,
        activityLog,
        reconcileCustody,
      };
    } catch (e) {
      await conn.rollback();
      logReconcileFailure('purge.transaction', orgId, e, {
        openingDate: bounds.openingDate,
        openingRef: bounds.openingRef,
      });
      throw e;
    } finally {
      conn.release();
    }
  }

  private async openingBounds(
    ctx: UserContext
  ): Promise<{ openingDate: string; openingRef: string }> {
    const today = new Date().toISOString().slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const bounds = resolveInvestPeriodBounds(events);
    const openingDate = bounds.openingDate;
    if (!openingDate) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        'Nenhuma abertura (opening_balance) no livro — importe o inventário inicial antes do purge.',
        422
      );
    }
    return { openingDate, openingRef: `OPENING:${openingDate}` };
  }

  private async buildPreview(
    orgId: string,
    openingDate: string,
    openingRef: string
  ): Promise<HoldingPurgePreview> {
    const conn = await this.pool.getConnection();
    try {
      const openingEventIds = await this.loadOpeningEventIds(conn, orgId, openingDate, openingRef);
      const openingInSql =
        openingEventIds.length > 0 ? openingEventIds : ['00000000-0000-0000-0000-000000000000'];

      const preservePle = `(business_event_id IN (?) OR (movement_type = 'opening_balance' AND transaction_date = ?))`;
      const preserveFle = `(
        business_event_id IN (?)
        OR (
          transaction_date = ?
          AND (
            description LIKE '%Saldo inicial%'
            OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'opening_balance'
          )
        )
      )`;

      const [wouldPle] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
         WHERE organization_id = ? AND deleted_at IS NULL AND NOT ${preservePle}`,
        [orgId, openingInSql, openingDate]
      );
      const [wouldFle] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM financial_ledger_entries
         WHERE organization_id = ? AND deleted_at IS NULL AND NOT ${preserveFle}`,
        [orgId, openingInSql, openingDate]
      );

      const [openingLegCountRow] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
         WHERE organization_id = ? AND deleted_at IS NULL AND ${preservePle}`,
        [orgId, openingInSql, openingDate]
      );

      const auxRowsToRemove: Record<string, number> = {};
      for (const t of AUX_ORG_TABLES) {
        auxRowsToRemove[t] = await this.countOrgRows(conn, orgId, t);
      }

      const [beCount] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM business_events be
         WHERE be.organization_id = ?
           AND be.deleted_at IS NULL
           AND be.source_ref <> ?`,
        [orgId, openingRef]
      );

      const openingLegCount = Number(openingLegCountRow[0]?.n ?? 0);
      let canPurge = openingLegCount > 0 || openingEventIds.length > 0;
      let abortReason: string | undefined;
      if (!canPurge) {
        abortReason = `Sem abertura em ${openingDate} (${openingRef}). Purge cancelado.`;
      }

      return {
        openingDate,
        openingRef,
        openingEventIds,
        openingLegCount,
        patrimonyLegsToRemove: Number(wouldPle[0]?.n ?? 0),
        financialLegsToRemove: Number(wouldFle[0]?.n ?? 0),
        businessEventsToRemove: Number(beCount[0]?.n ?? 0),
        auxRowsToRemove,
        canPurge,
        abortReason,
      };
    } finally {
      conn.release();
    }
  }

  private async executePurgeOnConnection(
    conn: PoolConnection,
    orgId: string,
    openingDate: string,
    openingRef: string,
    openingEventIds: string[],
    log?: (message: string, command: string, level?: ReconcileActivityStep['level']) => void
  ): Promise<{
    patrimonyLegsRemoved: number;
    financialLegsRemoved: number;
    businessEventsRemoved: number;
  }> {
    const openingInSql =
      openingEventIds.length > 0 ? openingEventIds : ['00000000-0000-0000-0000-000000000000'];
    const preservePle = `(business_event_id IN (?) OR (movement_type = 'opening_balance' AND transaction_date = ?))`;
    const preserveFle = `(
      business_event_id IN (?)
      OR (
        transaction_date = ?
        AND (
          description LIKE '%Saldo inicial%'
          OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'opening_balance'
        )
      )
    )`;

    const unlinked = await clearLedgerCrossLinksForOpeningPurge(
      conn,
      orgId,
      openingDate,
      openingInSql
    );
    log?.(
      `Desvinculado ple↔fle: ${unlinked.pleUnlinked} patrimonial, ${unlinked.fleUnlinked} financeiro`,
      'purge.unlink_cross_refs'
    );

    const [fle] = await conn.query<ResultSetHeader>(
      `DELETE FROM financial_ledger_entries
       WHERE organization_id = ? AND NOT ${preserveFle}`,
      [orgId, openingInSql, openingDate]
    );
    log?.(`DELETE financial_ledger_entries: ${fle.affectedRows}`, 'purge.financial_ledger');

    const [ple] = await conn.query<ResultSetHeader>(
      `DELETE FROM patrimony_ledger_entries
       WHERE organization_id = ? AND NOT ${preservePle}`,
      [orgId, openingInSql, openingDate]
    );
    log?.(`DELETE patrimony_ledger_entries: ${ple.affectedRows}`, 'purge.patrimony_ledger');

    const [be] = await conn.query<ResultSetHeader>(
      `DELETE be FROM business_events be
       WHERE be.organization_id = ?
         AND be.deleted_at IS NULL
         AND be.source_ref <> ?
         AND NOT EXISTS (
           SELECT 1 FROM patrimony_ledger_entries ple
           WHERE ple.business_event_id = be.id AND ple.organization_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM financial_ledger_entries fle
           WHERE fle.business_event_id = be.id AND fle.organization_id = ?
         )`,
      [orgId, openingRef, orgId, orgId]
    );
    log?.(`DELETE business_events: ${be.affectedRows}`, 'purge.business_events');

    const orphanDeps = await deleteOrphanPatrimonyItemDependents(conn, orgId);
    if (orphanDeps.optionExt > 0) {
      log?.(
        `DELETE invest_option_ext (órfãos): ${orphanDeps.optionExt}`,
        'purge.option_ext'
      );
    }
    if (orphanDeps.positionExt > 0) {
      log?.(
        `DELETE invest_position_ext (órfãos): ${orphanDeps.positionExt}`,
        'purge.position_ext'
      );
    }
    if (orphanDeps.itemLocations > 0) {
      log?.(
        `DELETE patrimony_item_locations (órfãos): ${orphanDeps.itemLocations}`,
        'purge.item_locations'
      );
    }

    const [piDel] = await conn.query<ResultSetHeader>(
      `DELETE pi FROM patrimony_items pi
       LEFT JOIN patrimony_ledger_entries ple ON ple.patrimony_item_id = pi.id
       WHERE pi.organization_id = ? AND ple.id IS NULL`,
      [orgId]
    );
    log?.(`DELETE patrimony_items (órfãos): ${piDel.affectedRows}`, 'purge.patrimony_items');

    await conn.query(
      `UPDATE patrimony_items pi
       INNER JOIN (
         SELECT patrimony_item_id,
                SUM(quantity_delta) AS qty,
                SUM(total_value) AS tv
         FROM patrimony_ledger_entries
         WHERE organization_id = ?
         GROUP BY patrimony_item_id
       ) agg ON agg.patrimony_item_id = pi.id
       SET pi.quantity = agg.qty,
           pi.acquisition_value = agg.tv,
           pi.current_value = agg.tv
       WHERE pi.organization_id = ?`,
      [orgId, orgId]
    );

    await conn.query<ResultSetHeader>(
      `DELETE ioe FROM invest_option_ext ioe
       LEFT JOIN patrimony_items pi ON pi.id = ioe.patrimony_item_id
       WHERE ioe.organization_id = ? AND pi.id IS NULL`,
      [orgId]
    );

    await conn.query<ResultSetHeader>(
      `DELETE ipe FROM invest_position_ext ipe
       LEFT JOIN patrimony_items pi ON pi.id = ipe.patrimony_item_id
       WHERE ipe.organization_id = ? AND pi.id IS NULL`,
      [orgId]
    );

    for (const table of AUX_ORG_TABLES) {
      const n = await this.deleteOrgTable(conn, orgId, table);
      log?.(`DELETE ${table}: ${n} linha(s)`, `purge.${table}`);
    }

    const [faDel] = await conn.query<ResultSetHeader>(
      `DELETE FROM financial_accounts
       WHERE organization_id = ?
         AND id NOT IN (
           SELECT DISTINCT account_id FROM financial_ledger_entries
           WHERE organization_id = ? AND account_id IS NOT NULL
         )`,
      [orgId, orgId]
    );
    log?.(`DELETE financial_accounts (órfãs): ${faDel.affectedRows}`, 'purge.financial_accounts');

    return {
      patrimonyLegsRemoved: ple.affectedRows,
      financialLegsRemoved: fle.affectedRows,
      businessEventsRemoved: be.affectedRows,
    };
  }

  private async loadOpeningEventIds(
    conn: PoolConnection,
    orgId: string,
    openingDate: string,
    openingRef: string
  ): Promise<string[]> {
    const [openingEvents] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM business_events
       WHERE organization_id = ? AND deleted_at IS NULL AND source_ref = ?`,
      [orgId, openingRef]
    );
    const [openingLegEvents] = await conn.query<RowDataPacket[]>(
      `SELECT DISTINCT business_event_id AS id
       FROM patrimony_ledger_entries
       WHERE organization_id = ?
         AND deleted_at IS NULL
         AND movement_type = 'opening_balance'
         AND transaction_date = ?
         AND business_event_id IS NOT NULL`,
      [orgId, openingDate]
    );
    return [
      ...new Set([
        ...openingEvents.map((r) => String(r.id)),
        ...openingLegEvents.map((r) => String(r.id)),
      ]),
    ];
  }

  private async countOrgRows(
    conn: PoolConnection,
    orgId: string,
    table: string
  ): Promise<number> {
    try {
      const [r] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE organization_id = ?`,
        [orgId]
      );
      return Number(r[0]?.n ?? 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("doesn't exist") || msg.includes('Unknown column')) return 0;
      throw e;
    }
  }

  private async deleteOrgTable(
    conn: PoolConnection,
    orgId: string,
    table: string
  ): Promise<number> {
    try {
      const [r] = await conn.query<ResultSetHeader>(
        `DELETE FROM \`${table}\` WHERE organization_id = ?`,
        [orgId]
      );
      return r.affectedRows;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("doesn't exist") || msg.includes('Unknown column')) return 0;
      throw e;
    }
  }

  private requireOrg(ctx: UserContext): string {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Selecione uma organização (personifique a holding).', 400);
    }
    return ctx.organizationId;
  }
}
