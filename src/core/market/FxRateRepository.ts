import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext } from '../dal';
import type { SecurePayload } from '../dal/types';
import { authBootstrapContext } from '../auth/authBootstrapContext';

export type FxRateSource = 'ptax' | 'yahoo_finance' | 'manual' | string;

export type FxRateRow = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rateDate: string;
  closingRate: number;
  source: string;
  metadata: Record<string, unknown> | null;
};

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rowToFxRate(row: Record<string, unknown>): FxRateRow {
  return {
    id: String(row.id),
    fromCurrency: String(row.from_currency).toUpperCase(),
    toCurrency: String(row.to_currency).toUpperCase(),
    rateDate: String(row.rate_date).slice(0, 10),
    closingRate: Number(row.closing_rate),
    source: String(row.source ?? ''),
    metadata: parseMetadata(row.metadata),
  };
}

export class FxRateRepository {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async getRate(
    fromCurrency: string,
    toCurrency: string,
    asOfDate: string,
    ctx: UserContext = authBootstrapContext()
  ): Promise<FxRateRow | null> {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (!from || !to || from === to) {
      return from && to && from === to
        ? {
            id: `${from}-${to}-${asOfDate.slice(0, 10)}`,
            fromCurrency: from,
            toCurrency: to,
            rateDate: asOfDate.slice(0, 10),
            closingRate: 1,
            source: 'identity',
            metadata: null,
          }
        : null;
    }
    const rows = await this.gateway.readQuery(ctx, 'fx_rate_on_or_before', [
      from,
      to,
      asOfDate.slice(0, 10),
    ]);
    return rows[0] ? rowToFxRate(rows[0]) : null;
  }

  async getClosingRate(
    fromCurrency: string,
    toCurrency: string,
    asOfDate: string,
    ctx?: UserContext
  ): Promise<number | null> {
    return (await this.getRate(fromCurrency, toCurrency, asOfDate, ctx))?.closingRate ?? null;
  }

  async upsertRate(
    input: {
      fromCurrency: string;
      toCurrency: string;
      rateDate: string;
      closingRate: number;
      source: FxRateSource;
      metadata?: Record<string, unknown> | null;
    },
    ctx: UserContext = authBootstrapContext()
  ): Promise<FxRateRow> {
    const from = input.fromCurrency.trim().toUpperCase();
    const to = input.toCurrency.trim().toUpperCase();
    const rateDate = input.rateDate.slice(0, 10);
    const existing = await this.gateway.findWhere(
      ctx,
      'fx_rates',
      { from_currency: from, to_currency: to, rate_date: rateDate },
      { limit: 1, columns: ['id'] }
    );

    const payload: SecurePayload = {
      from_currency: from,
      to_currency: to,
      rate_date: rateDate,
      closing_rate: input.closingRate,
      source: input.source,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    };

    const id = existing[0]?.id ? String(existing[0].id) : randomUUID();
    if (existing[0]?.id) {
      await this.gateway.update(ctx, 'fx_rates', id, payload);
    } else {
      await this.gateway.insert(ctx, 'fx_rates', { id, ...payload });
    }
    return {
      id,
      fromCurrency: from,
      toCurrency: to,
      rateDate,
      closingRate: input.closingRate,
      source: String(input.source),
      metadata: input.metadata ?? null,
    };
  }
}
