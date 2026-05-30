import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import {
  btgPatrimonyAnchorReferenceForOrg,
  HOLDING_BTG_PATRIMONY_ANCHORS,
} from './btgPatrimonyAnchorReference';
import type { PatrimonyAnchorFile } from './patrimonyAnchors';

export type SeedPatrimonyAnchorsResult = {
  upserted: number;
  points: Array<{ date: string; patrimony: number; source: string }>;
  fixedIncomeTotal: number | null;
};

function anchorSourceForDate(date: string): string {
  if (date.endsWith('-01') && date !== '1970-01-01') return 'btg_custody_open';
  return 'btg_custody';
}

/**
 * Grava âncoras mensais BTG via gateway (sem migration SQL).
 * Fonte: referência homebroker da org ou payload explícito.
 */
export class PatrimonyMonthlyAnchorsSeedService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  resolveReference(ctx: UserContext): PatrimonyAnchorFile | null {
    return btgPatrimonyAnchorReferenceForOrg(ctx.organizationId) ?? null;
  }

  async seedFromHomebrokerReference(ctx: UserContext): Promise<SeedPatrimonyAnchorsResult> {
    const ref = this.resolveReference(ctx);
    if (!ref?.month_ends?.length) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        'Sem referência BTG homebroker para esta organização.',
        404
      );
    }
    return this.seedFromFile(ctx, ref);
  }

  async seedFromFile(ctx: UserContext, file: PatrimonyAnchorFile): Promise<SeedPatrimonyAnchorsResult> {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Personifique a holding antes de gravar âncoras.', 400);
    }

    const points: SeedPatrimonyAnchorsResult['points'] = [];
    let upserted = 0;

    for (const point of file.month_ends) {
      const date = point.date.slice(0, 10);
      const patrimony = Math.round(point.patrimony * 10000) / 10000;
      const source = anchorSourceForDate(date);
      await this.upsertAnchor(ctx, date, patrimony, source, 'Homebroker BTG (seed via conciliação)');
      points.push({ date, patrimony, source });
      upserted += 1;
    }

    let fixedIncomeTotal: number | null = null;
    const fi = Number(file.fixed_income_total ?? 0);
    if (fi > 0) {
      await this.upsertAnchor(
        ctx,
        '1970-01-01',
        fi,
        'fixed_income_total',
        'RF total — homebroker BTG'
      );
      fixedIncomeTotal = fi;
      upserted += 1;
    }

    return { upserted, points, fixedIncomeTotal };
  }

  private async upsertAnchor(
    ctx: UserContext,
    referenceDate: string,
    patrimony: number,
    source: string,
    notes: string
  ): Promise<void> {
    const existing = await this.gateway.findWhere(
      ctx,
      'invest_patrimony_monthly_anchors',
      {
        organization_id: ctx.organizationId,
        reference_date: referenceDate,
      },
      { limit: 1, columns: ['id'] }
    );

    const payload = {
      organization_id: ctx.organizationId,
      reference_date: referenceDate,
      patrimony,
      source,
      notes,
    };

    if (existing[0]?.id) {
      await this.gateway.update(
        ctx,
        'invest_patrimony_monthly_anchors',
        String(existing[0].id),
        payload
      );
      return;
    }

    const id = `ipa-seed-${ctx.organizationId}-${referenceDate}-${source}`.slice(0, 36);
    await this.gateway.insert(ctx, 'invest_patrimony_monthly_anchors', { id, ...payload });
  }
}

/** Referência canônica exportada para testes e documentação. */
export const HOME_BROKER_ANCHOR_REFERENCE = HOLDING_BTG_PATRIMONY_ANCHORS;
