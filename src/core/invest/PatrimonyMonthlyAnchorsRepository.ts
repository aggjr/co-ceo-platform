import type { CoCeoDataGateway, UserContext } from '../dal';
import { isMissingSchemaError } from '../dal/mysqlErrors';
import { btgPatrimonyAnchorReferenceForOrg } from './btgPatrimonyAnchorReference';
import type { PatrimonyAnchorFile } from './patrimonyAnchors';

const FIXED_INCOME_SOURCE = 'fixed_income_total';

function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

function rowsToAnchorFile(rows: Record<string, unknown>[]): PatrimonyAnchorFile {
  const month_ends: Array<{ date: string; patrimony: number }> = [];
  let fixed_income_total = 0;

  for (const row of rows) {
    const source = String(row.source ?? 'btg_custody');
    const patrimony = Number(row.patrimony);
    if (!Number.isFinite(patrimony)) continue;
    if (source === FIXED_INCOME_SOURCE) {
      fixed_income_total = patrimony;
      continue;
    }
    month_ends.push({
      date: toIsoDate(row.reference_date),
      patrimony,
    });
  }

  month_ends.sort((a, b) => a.date.localeCompare(b.date));
  return { month_ends, fixed_income_total };
}

export class PatrimonyMonthlyAnchorsRepository {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async loadForOrganization(ctx: UserContext): Promise<PatrimonyAnchorFile> {
    if (!ctx.organizationId) {
      return { month_ends: [], fixed_income_total: 0 };
    }

    try {
      const rows = await this.gateway.findWhere(
        ctx,
        'invest_patrimony_monthly_anchors',
        { organization_id: ctx.organizationId },
        { columns: ['reference_date', 'patrimony', 'source'] }
      );
      if (rows.length > 0) {
        return rowsToAnchorFile(rows);
      }
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    return (
      btgPatrimonyAnchorReferenceForOrg(ctx.organizationId) ?? {
        month_ends: [],
        fixed_income_total: 0,
      }
    );
  }
}
