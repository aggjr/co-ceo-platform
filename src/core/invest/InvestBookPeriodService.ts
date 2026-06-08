import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';

export const INVEST_BOOK_CODE = 'INVEST';

export type InvestBookPeriod = {
  id: string | null;
  organizationId: string;
  bookCode: string;
  openingDate: string;
  openingSourceRef: string;
  openingSourceRefs: string[];
  fiscalYear: number | null;
  status: 'active' | 'closed' | 'archived';
  isDefault: boolean;
  source: 'catalog' | 'business_events' | 'ledger' | 'financial_accounts';
};

type BookPeriodRow = {
  id?: string | null;
  organization_id?: string | null;
  book_code?: string | null;
  opening_date?: string | Date | null;
  opening_source_ref?: string | null;
  fiscal_year?: number | string | null;
  status?: string | null;
  is_default?: boolean | number | string | null;
};

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(Boolean).map((v) => String(v)))];
}

export class InvestBookPeriodService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async resolveDefault(ctx: UserContext): Promise<InvestBookPeriod> {
    const organizationId = this.requireOrg(ctx);
    const catalog = await this.resolveFromCatalog(ctx, organizationId);
    if (catalog) return catalog;

    const inferred =
      (await this.resolveFromBusinessEvents(ctx, organizationId)) ??
      (await this.resolveFromLedger(ctx, organizationId)) ??
      (await this.resolveFromFinancialAccounts(ctx, organizationId));
    if (inferred) return inferred;

    throw new GatewayError(
      'INVEST_BOOK_PERIOD_NOT_FOUND',
      'Nenhuma abertura INVEST encontrada para a organização. Configure invest_book_periods ou importe o opening_balance antes da conciliação.',
      422
    );
  }

  private async resolveFromCatalog(
    ctx: UserContext,
    organizationId: string
  ): Promise<InvestBookPeriod | null> {
    const rows = (await this.gateway.findWhere(ctx, 'invest_book_periods', {
      book_code: INVEST_BOOK_CODE,
    })) as BookPeriodRow[];

    const active = rows
      .filter((row) => String(row.status ?? 'active') === 'active')
      .filter((row) => toIsoDate(row.opening_date))
      .sort((a, b) => {
        const aDefault = toBool(a.is_default);
        const bDefault = toBool(b.is_default);
        if (aDefault !== bDefault) return aDefault ? -1 : 1;
        return String(b.opening_date).localeCompare(String(a.opening_date));
      });
    const row = active[0];
    const openingDate = toIsoDate(row?.opening_date);
    if (!row || !openingDate) return null;
    const openingSourceRef = String(row.opening_source_ref || `OPENING:${openingDate}`);
    return {
      id: row.id ? String(row.id) : null,
      organizationId,
      bookCode: String(row.book_code || INVEST_BOOK_CODE),
      openingDate,
      openingSourceRef,
      openingSourceRefs: this.compatibleOpeningRefs(openingDate, openingSourceRef),
      fiscalYear: row.fiscal_year == null ? null : Number(row.fiscal_year),
      status: String(row.status || 'active') as InvestBookPeriod['status'],
      isDefault: toBool(row.is_default),
      source: 'catalog',
    };
  }

  private async resolveFromBusinessEvents(
    ctx: UserContext,
    organizationId: string
  ): Promise<InvestBookPeriod | null> {
    const rows = await this.gateway.findWhere(ctx, 'business_events', {
      event_kind: 'opening_balance',
    }, { limit: 100 });
    const candidates = rows
      .map((row) => ({
        date: toIsoDate(row.occurred_on) ?? toIsoDate(row.settles_on),
        ref: row.source_ref ? String(row.source_ref) : null,
      }))
      .filter((row): row is { date: string; ref: string | null } => Boolean(row.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    const first = candidates[0];
    if (!first) return null;
    const openingSourceRef = first.ref || `OPENING:${first.date}`;
    return this.inferred(organizationId, first.date, openingSourceRef, 'business_events');
  }

  private async resolveFromLedger(
    ctx: UserContext,
    organizationId: string
  ): Promise<InvestBookPeriod | null> {
    const rows = await this.gateway.findWhere(ctx, 'patrimony_ledger_entries', {
      movement_type: 'opening_balance',
    }, { limit: 100 });
    const dates = rows
      .map((row) => toIsoDate(row.transaction_date))
      .filter((date): date is string => Boolean(date))
      .sort();
    const openingDate = dates[0];
    if (!openingDate) return null;
    return this.inferred(organizationId, openingDate, `OPENING:${openingDate}`, 'ledger');
  }

  private async resolveFromFinancialAccounts(
    ctx: UserContext,
    organizationId: string
  ): Promise<InvestBookPeriod | null> {
    const rows = await this.gateway.findWhere(ctx, 'financial_accounts', {
      source_module: INVEST_BOOK_CODE,
    }, { limit: 100 });
    const dates = rows
      .map((row) => toIsoDate(row.opening_date))
      .filter((date): date is string => Boolean(date))
      .sort();
    const openingDate = dates[0];
    if (!openingDate) return null;
    return this.inferred(
      organizationId,
      openingDate,
      `OPENING:${openingDate}`,
      'financial_accounts'
    );
  }

  private inferred(
    organizationId: string,
    openingDate: string,
    openingSourceRef: string,
    source: InvestBookPeriod['source']
  ): InvestBookPeriod {
    return {
      id: null,
      organizationId,
      bookCode: INVEST_BOOK_CODE,
      openingDate,
      openingSourceRef,
      openingSourceRefs: this.compatibleOpeningRefs(openingDate, openingSourceRef),
      fiscalYear: Number(openingDate.slice(0, 4)),
      status: 'active',
      isDefault: true,
      source,
    };
  }

  private compatibleOpeningRefs(openingDate: string, openingSourceRef: string): string[] {
    return uniq([
      openingSourceRef,
      `OPENING:${openingDate}`,
      `INVEST-OPENING-${openingDate}`,
    ]);
  }

  private requireOrg(ctx: UserContext): string {
    if (!ctx.organizationId) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'Selecione uma organização para resolver o período do livro INVEST.',
        400
      );
    }
    return ctx.organizationId;
  }
}
