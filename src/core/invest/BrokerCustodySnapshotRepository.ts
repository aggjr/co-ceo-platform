import type { CoCeoDataGateway, UserContext } from '../dal';
import type {
  BrokerCustodySnapshotInput,
  BrokerCustodySnapshotLineInput,
  BrokerCustodySnapshotRecord,
  BrokerPatrimonyComposition,
} from './brokerCustodySnapshotTypes';

function snapshotId(orgId: string, broker: string, refDate: string): string {
  return `ibs-${orgId}-${broker}-${refDate}`.slice(0, 64);
}

function lineId(snapshotId: string, ticker: string, kind: string, leg: string): string {
  return `${snapshotId}-${ticker}-${kind}-${leg}`.slice(0, 96);
}

function rowToRecord(
  header: Record<string, unknown>,
  lines: BrokerCustodySnapshotLineInput[]
): BrokerCustodySnapshotRecord {
  return {
    id: String(header.id),
    organizationId: String(header.organization_id),
    schemaVersion: 1,
    broker: String(header.broker_code),
    referenceDate: String(header.reference_date).slice(0, 10),
    status: String(header.status) as BrokerCustodySnapshotRecord['status'],
    sourceLabel: header.source_label != null ? String(header.source_label) : null,
    notes: header.notes != null ? String(header.notes) : null,
    composition: {
      variableIncome: Number(header.variable_income ?? 0),
      fixedIncome: Number(header.fixed_income ?? 0),
      cash: Number(header.cash_balance ?? 0),
      inTransit: Number(header.in_transit ?? 0),
      derivatives: Number(header.derivatives ?? 0),
      totalPatrimony: Number(header.total_patrimony ?? 0),
    },
    positions: lines,
  };
}

export class BrokerCustodySnapshotRepository {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async upsertFromInput(
    ctx: UserContext,
    input: BrokerCustodySnapshotInput
  ): Promise<BrokerCustodySnapshotRecord> {
    const orgId = ctx.organizationId!;
    const id = snapshotId(orgId, input.broker, input.referenceDate);
    const comp = input.composition;

    const existing = await this.gateway.findWhere(
      ctx,
      'invest_broker_custody_snapshots',
      {
        organization_id: orgId,
        broker_code: input.broker,
        reference_date: input.referenceDate,
      },
      { limit: 1 }
    );

    const headerPayload = {
      organization_id: orgId,
      broker_code: input.broker,
      reference_date: input.referenceDate,
      status: 'imported',
      variable_income: comp.variableIncome,
      fixed_income: comp.fixedIncome,
      cash_balance: comp.cash,
      in_transit: comp.inTransit,
      derivatives: comp.derivatives,
      total_patrimony: comp.totalPatrimony,
      source_label: input.sourceLabel ?? 'homebroker_import',
      notes: input.notes ?? null,
      applied_at: null,
    };

    if (existing[0]?.id) {
      await this.gateway.update(ctx, 'invest_broker_custody_snapshots', String(existing[0].id), {
        ...headerPayload,
        id: String(existing[0].id),
      });
      await this.gateway.deleteMatching(ctx, 'invest_broker_custody_snapshot_lines', {
        snapshot_id: String(existing[0].id),
      });
    } else {
      await this.gateway.insert(ctx, 'invest_broker_custody_snapshots', {
        id,
        ...headerPayload,
      });
    }

    const snapId = existing[0]?.id ? String(existing[0].id) : id;
    for (const line of input.positions) {
      const leg = line.legTag ?? line.lineKind;
      await this.gateway.insert(ctx, 'invest_broker_custody_snapshot_lines', {
        id: lineId(snapId, line.ticker, line.lineKind, leg),
        snapshot_id: snapId,
        organization_id: orgId,
        ticker: line.ticker.toUpperCase(),
        line_kind: line.lineKind,
        quantity: line.quantity,
        last_price: line.lastPrice ?? null,
        market_value: line.marketValue ?? null,
        avg_price: line.avgPrice ?? null,
        leg_tag: line.legTag ?? null,
      });
    }

    return this.loadById(ctx, snapId);
  }

  async loadById(ctx: UserContext, snapshotId: string): Promise<BrokerCustodySnapshotRecord> {
    const headers = await this.gateway.findWhere(
      ctx,
      'invest_broker_custody_snapshots',
      { id: snapshotId, organization_id: ctx.organizationId },
      { limit: 1 }
    );
    if (!headers[0]) throw new Error(`Snapshot ${snapshotId} não encontrado.`);
    const lineRows = await this.gateway.findWhere(
      ctx,
      'invest_broker_custody_snapshot_lines',
      { snapshot_id: snapshotId },
      { limit: 500 }
    );
    const lines: BrokerCustodySnapshotLineInput[] = lineRows.map((r) => ({
      ticker: String(r.ticker).toUpperCase(),
      lineKind: String(r.line_kind) as BrokerCustodySnapshotLineInput['lineKind'],
      quantity: Number(r.quantity),
      lastPrice: r.last_price != null ? Number(r.last_price) : null,
      marketValue: r.market_value != null ? Number(r.market_value) : null,
      avgPrice: r.avg_price != null ? Number(r.avg_price) : null,
      legTag: r.leg_tag != null ? String(r.leg_tag) : null,
    }));
    return rowToRecord(headers[0], lines);
  }

  async loadByReferenceDate(
    ctx: UserContext,
    referenceDate: string,
    broker = 'btg'
  ): Promise<BrokerCustodySnapshotRecord | null> {
    const headers = await this.gateway.findWhere(
      ctx,
      'invest_broker_custody_snapshots',
      {
        organization_id: ctx.organizationId,
        broker_code: broker,
        reference_date: referenceDate.slice(0, 10),
      },
      { limit: 1 }
    );
    if (!headers[0]?.id) return null;
    return this.loadById(ctx, String(headers[0].id));
  }

  async loadLatest(ctx: UserContext, broker = 'btg'): Promise<BrokerCustodySnapshotRecord | null> {
    const headers = await this.gateway.findWhere(
      ctx,
      'invest_broker_custody_snapshots',
      { organization_id: ctx.organizationId, broker_code: broker },
      { limit: 200 }
    );
    if (!headers.length) return null;
    headers.sort((a, b) =>
      String(b.reference_date ?? '').localeCompare(String(a.reference_date ?? ''))
    );
    return this.loadById(ctx, String(headers[0].id));
  }

  async markApplied(ctx: UserContext, snapshotId: string): Promise<void> {
    await this.gateway.update(ctx, 'invest_broker_custody_snapshots', snapshotId, {
      status: 'applied',
      applied_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  }
}
