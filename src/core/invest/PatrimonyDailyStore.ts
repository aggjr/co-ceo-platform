import { randomUUID } from 'crypto';
import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import type { DailyPatrimonyPoint } from './PatrimonyDailyEngine';
import type { PositionDailySnapshot } from './PatrimonyMtmDailyEngine';

export type StoredPortfolioDay = {
  id: string;
  organization_id: string;
  snapshot_date: string;
  patrimony: number;
  patrimony_gross: number;
  cash: number;
  positions_value: number;
  pending_settlements: number;
  fixed_income_total: number;
  external_flow: number;
  daily_return_simple: number | null;
  daily_return_twr: number | null;
  cumulative_twr: number | null;
  quotes_as_of: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
};

export type RecordPortfolioDayInput = {
  snapshotDate: string;
  point: DailyPatrimonyPoint;
  patrimonyGross: number;
  fixedIncomeTotal: number;
  externalFlow: number;
  dailyReturnTwr: number | null;
  cumulativeTwr: number | null;
  quotesAsOf: string | null;
  positionSnapshots: PositionDailySnapshot[];
  stockQuotes: Record<string, number>;
};

function rowToStored(row: Record<string, unknown>): StoredPortfolioDay {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata =
        typeof row.metadata === 'string'
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : (row.metadata as Record<string, unknown>);
    } catch {
      metadata = null;
    }
  }
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    snapshot_date: String(row.snapshot_date).slice(0, 10),
    patrimony: Number(row.patrimony),
    patrimony_gross: Number(row.patrimony_gross),
    cash: Number(row.cash),
    positions_value: Number(row.positions_value),
    pending_settlements: Number(row.pending_settlements ?? 0),
    fixed_income_total: Number(row.fixed_income_total ?? 0),
    external_flow: Number(row.external_flow ?? 0),
    daily_return_simple: row.daily_return_simple != null ? Number(row.daily_return_simple) : null,
    daily_return_twr: row.daily_return_twr != null ? Number(row.daily_return_twr) : null,
    cumulative_twr: row.cumulative_twr != null ? Number(row.cumulative_twr) : null,
    quotes_as_of: row.quotes_as_of ? String(row.quotes_as_of).slice(0, 10) : null,
    source: String(row.source ?? 'mtm_economic'),
    metadata,
  };
}

export class PatrimonyDailyStore {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async loadRange(ctx: UserContext, from: string, to: string): Promise<StoredPortfolioDay[]> {
    if (!ctx.organizationId) return [];
    const rows = await this.gateway.readQuery(ctx, 'invest_portfolio_daily_range', [
      ctx.organizationId,
      from,
      to,
    ]);
    return rows.map(rowToStored);
  }

  async loadDayBefore(ctx: UserContext, beforeDate: string): Promise<StoredPortfolioDay | null> {
    if (!ctx.organizationId) return null;
    const rows = await this.gateway.readQuery(ctx, 'invest_portfolio_daily_before', [
      ctx.organizationId,
      beforeDate,
    ]);
    return rows[0] ? rowToStored(rows[0]) : null;
  }

  async upsertPortfolioDay(ctx: UserContext, input: RecordPortfolioDayInput): Promise<StoredPortfolioDay> {
    if (!ctx.organizationId) {
      throw new Error('organizationId obrigatório para gravar patrimônio diário.');
    }
    const orgId = ctx.organizationId;
    const existing = await this.gateway.findWhere(
      ctx,
      'invest_portfolio_daily',
      { organization_id: orgId, snapshot_date: input.snapshotDate },
      { limit: 1, columns: ['id'] }
    );

    const metadata = {
      stock_quotes: input.stockQuotes,
      positions_count: input.positionSnapshots.length,
    };

    const payload = {
      organization_id: orgId,
      snapshot_date: input.snapshotDate,
      patrimony: input.point.patrimony,
      patrimony_gross: input.patrimonyGross,
      cash: input.point.cash,
      positions_value: input.point.positionsValue,
      pending_settlements: input.point.pendingSettlements,
      fixed_income_total: input.fixedIncomeTotal,
      external_flow: input.externalFlow,
      daily_return_simple: input.point.dailyReturn,
      daily_return_twr: input.dailyReturnTwr,
      cumulative_twr: input.cumulativeTwr,
      quotes_as_of: input.quotesAsOf,
      source: 'mtm_economic',
      metadata: JSON.stringify(metadata),
    };

    let recordId: string;
    if (existing[0]?.id) {
      recordId = String(existing[0].id);
      await this.gateway.update(ctx, 'invest_portfolio_daily', recordId, payload);
    } else {
      recordId = randomUUID();
      await this.gateway.insert(ctx, 'invest_portfolio_daily', { id: recordId, ...payload });
    }

    await this.upsertAssetSnapshots(ctx, input.snapshotDate, input.positionSnapshots);

    return {
      id: recordId,
      organization_id: orgId,
      snapshot_date: input.snapshotDate,
      patrimony: input.point.patrimony,
      patrimony_gross: input.patrimonyGross,
      cash: input.point.cash,
      positions_value: input.point.positionsValue,
      pending_settlements: input.point.pendingSettlements,
      fixed_income_total: input.fixedIncomeTotal,
      external_flow: input.externalFlow,
      daily_return_simple: input.point.dailyReturn,
      daily_return_twr: input.dailyReturnTwr,
      cumulative_twr: input.cumulativeTwr,
      quotes_as_of: input.quotesAsOf,
      source: 'mtm_economic',
      metadata,
    };
  }

  private async upsertAssetSnapshots(
    ctx: UserContext,
    snapshotDate: string,
    positions: PositionDailySnapshot[]
  ): Promise<void> {
    if (!ctx.organizationId) return;

    for (const p of positions) {
      const existing = await this.gateway.findWhere(
        ctx,
        'invest_daily_snapshots',
        {
          organization_id: ctx.organizationId,
          asset_id: p.assetId,
          snapshot_date: snapshotDate,
        },
        { limit: 1, columns: ['id'] }
      );

      const unrealized = Math.round((p.marketValue - p.managerialValue) * 100) / 100;
      const payload = {
        organization_id: ctx.organizationId,
        asset_id: p.assetId,
        snapshot_date: snapshotDate,
        closing_price: p.closingPrice,
        quantity_held: p.quantity,
        managerial_avg_price: p.unitCost,
        total_market_value: p.marketValue,
        total_managerial_value: p.managerialValue,
        unrealized_pnl: unrealized,
      };

      if (existing[0]?.id) {
        await this.gateway.update(ctx, 'invest_daily_snapshots', String(existing[0].id), payload);
      } else {
        await this.gateway.insert(ctx, 'invest_daily_snapshots', {
          id: randomUUID(),
          ...payload,
        });
      }
    }
  }
}

/** Substitui dias gravados na série calculada (histórico recente = dado real). */
export function mergeStoredPatrimonySeries(
  computed: DailyPatrimonyPoint[],
  stored: StoredPortfolioDay[]
): { series: DailyPatrimonyPoint[]; storedDates: string[] } {
  if (!stored.length) return { series: computed, storedDates: [] };
  const byDate = new Map(stored.map((s) => [s.snapshot_date, s]));
  const storedDates: string[] = [];
  const series = computed.map((p) => {
    const s = byDate.get(p.date);
    if (!s) return p;
    storedDates.push(p.date);
    return {
      date: p.date,
      patrimonyGross: s.patrimony_gross,
      pendingSettlements: s.pending_settlements,
      scheduledCashPending: p.scheduledCashPending,
      patrimony: s.patrimony,
      cash: s.cash,
      positionsValue: s.positions_value,
      dailyReturn: s.daily_return_simple ?? p.dailyReturn,
    };
  });
  return { series, storedDates };
}
