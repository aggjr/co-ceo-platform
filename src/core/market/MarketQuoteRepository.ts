import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../dal';
import { isMissingSchemaError } from '../dal/mysqlErrors';

export type QuoteSource =
  | 'brapi'
  | 'opcoes_net'
  | 'tesouro_direto'
  | 'computed_cdi'
  | 'computed_pre'
  | 'computed_ipca'
  | 'user_manual';

export type MarketQuoteRow = {
  id: string;
  ticker: string;
  quote_date: string;
  closing_price: number;
  open_price: number | null;
  min_price: number | null;
  max_price: number | null;
  volume: number | null;
  currency: string;
  source: QuoteSource;
  source_fetched_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type MarketIndexRow = {
  id: string;
  index_code: string;
  reference_date: string;
  daily_factor: number;
  annualized_rate: number | null;
  source: string;
};

export type UpsertQuoteInput = {
  ticker: string;
  quoteDate: string;
  closingPrice: number;
  openPrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  volume?: number | null;
  currency?: string;
  source: QuoteSource;
  sourceFetchedAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type UpsertIndexInput = {
  indexCode: string;
  referenceDate: string;
  dailyFactor: number;
  annualizedRate?: number | null;
  source: string;
};

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function rowToQuote(row: Record<string, unknown>): MarketQuoteRow {
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
    ticker: String(row.ticker),
    quote_date: toIsoDate(row.quote_date),
    closing_price: Number(row.closing_price),
    open_price: row.open_price != null ? Number(row.open_price) : null,
    min_price: row.min_price != null ? Number(row.min_price) : null,
    max_price: row.max_price != null ? Number(row.max_price) : null,
    volume: row.volume != null ? Number(row.volume) : null,
    currency: String(row.currency ?? 'BRL'),
    source: String(row.source ?? 'user_manual') as QuoteSource,
    source_fetched_at: row.source_fetched_at ? String(row.source_fetched_at) : null,
    metadata,
  };
}

function rowToIndex(row: Record<string, unknown>): MarketIndexRow {
  return {
    id: String(row.id),
    index_code: String(row.index_code),
    reference_date: toIsoDate(row.reference_date),
    daily_factor: Number(row.daily_factor),
    annualized_rate: row.annualized_rate != null ? Number(row.annualized_rate) : null,
    source: String(row.source ?? ''),
  };
}

/**
 * Repositório das tabelas de mercado (cotações e índices globais).
 * Compartilhado entre todos os clientes — preço de PETR4 não tem organization_id.
 */
export class MarketQuoteRepository {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async upsertQuote(ctx: UserContext, input: UpsertQuoteInput): Promise<MarketQuoteRow> {
    const ticker = input.ticker.trim().toUpperCase();
    const quoteDate = input.quoteDate.slice(0, 10);
    if (!ticker || !quoteDate) {
      throw new Error('upsertQuote requer ticker e quoteDate.');
    }

    const existing = await this.gateway.findWhere(
      ctx,
      'market_quotes_daily',
      { ticker, quote_date: quoteDate },
      { limit: 1, columns: ['id'] }
    );

    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    const payload: SecurePayload = {
      ticker,
      quote_date: quoteDate,
      closing_price: input.closingPrice,
      open_price: input.openPrice ?? null,
      min_price: input.minPrice ?? null,
      max_price: input.maxPrice ?? null,
      volume: input.volume ?? null,
      currency: input.currency ?? 'BRL',
      source: input.source,
      source_fetched_at: input.sourceFetchedAt ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      metadata: metadataJson,
    };

    let recordId: string;
    if (existing[0]?.id) {
      recordId = String(existing[0].id);
      await this.gateway.update(ctx, 'market_quotes_daily', recordId, payload);
    } else {
      recordId = randomUUID();
      await this.gateway.insert(ctx, 'market_quotes_daily', { id: recordId, ...payload });
    }

    return {
      id: recordId,
      ticker,
      quote_date: quoteDate,
      closing_price: input.closingPrice,
      open_price: input.openPrice ?? null,
      min_price: input.minPrice ?? null,
      max_price: input.maxPrice ?? null,
      volume: input.volume ?? null,
      currency: input.currency ?? 'BRL',
      source: input.source,
      source_fetched_at: input.sourceFetchedAt ?? null,
      metadata: input.metadata ?? null,
    };
  }

  async getQuote(
    ctx: UserContext,
    ticker: string,
    quoteDate: string
  ): Promise<MarketQuoteRow | null> {
    const rows = await this.gateway.findWhere(
      ctx,
      'market_quotes_daily',
      { ticker: ticker.toUpperCase(), quote_date: quoteDate.slice(0, 10) },
      { limit: 1 }
    );
    return rows[0] ? rowToQuote(rows[0]) : null;
  }

  async getQuoteOnOrBefore(
    ctx: UserContext,
    ticker: string,
    quoteDate: string
  ): Promise<MarketQuoteRow | null> {
    const rows = await this.gateway.readQuery(ctx, 'market_quotes_daily_on_or_before', [
      ticker.toUpperCase(),
      quoteDate.slice(0, 10),
    ]);
    return rows[0] ? rowToQuote(rows[0]) : null;
  }

  async loadQuoteRange(
    ctx: UserContext,
    ticker: string,
    from: string,
    to: string
  ): Promise<MarketQuoteRow[]> {
    try {
      const rows = await this.gateway.readQuery(ctx, 'market_quotes_daily_range', [
        ticker.toUpperCase(),
        from.slice(0, 10),
        to.slice(0, 10),
      ]);
      return rows.map(rowToQuote);
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  async upsertIndex(ctx: UserContext, input: UpsertIndexInput): Promise<MarketIndexRow> {
    const indexCode = input.indexCode.trim().toUpperCase();
    const referenceDate = input.referenceDate.slice(0, 10);
    if (!indexCode || !referenceDate) {
      throw new Error('upsertIndex requer indexCode e referenceDate.');
    }

    const existing = await this.gateway.findWhere(
      ctx,
      'market_index_daily',
      { index_code: indexCode, reference_date: referenceDate },
      { limit: 1, columns: ['id'] }
    );

    const payload: SecurePayload = {
      index_code: indexCode,
      reference_date: referenceDate,
      daily_factor: input.dailyFactor,
      annualized_rate: input.annualizedRate ?? null,
      source: input.source,
    };

    let recordId: string;
    if (existing[0]?.id) {
      recordId = String(existing[0].id);
      await this.gateway.update(ctx, 'market_index_daily', recordId, payload);
    } else {
      recordId = randomUUID();
      await this.gateway.insert(ctx, 'market_index_daily', { id: recordId, ...payload });
    }

    return {
      id: recordId,
      index_code: indexCode,
      reference_date: referenceDate,
      daily_factor: input.dailyFactor,
      annualized_rate: input.annualizedRate ?? null,
      source: input.source,
    };
  }

  async getIndexOnOrBefore(
    ctx: UserContext,
    indexCode: string,
    referenceDate: string
  ): Promise<MarketIndexRow | null> {
    const rows = await this.gateway.readQuery(ctx, 'market_index_daily_on_or_before', [
      indexCode.toUpperCase(),
      referenceDate.slice(0, 10),
    ]);
    return rows[0] ? rowToIndex(rows[0]) : null;
  }

  async loadIndexRange(
    ctx: UserContext,
    indexCode: string,
    from: string,
    to: string
  ): Promise<MarketIndexRow[]> {
    try {
      const rows = await this.gateway.readQuery(ctx, 'market_index_daily_range', [
        indexCode.toUpperCase(),
        from.slice(0, 10),
        to.slice(0, 10),
      ]);
      return rows.map(rowToIndex);
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  /**
   * Carrega todas as cotações de um range de datas e devolve um mapa
   * { ticker → { date → closingPrice } } construído em memória.
   *
   * Uso: pré-carregar para um range antes de chamar buildDailyPatrimonyMtmSeries,
   * e passar como quoteForDate ao engine.
   *
   * Para o recorder de 1 dia, use from = to = snapshotDate.
   */
  async loadQuoteMapForRange(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<Map<string, Map<string, number>>> {
    try {
      const rows = await this.gateway.readQuery(ctx, 'market_quotes_bulk_range', [
        from.slice(0, 10),
        to.slice(0, 10),
      ]);
      const map = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const ticker = String(r.ticker ?? '').toUpperCase();
        const date = toIsoDate(r.quote_date);
        const price = Number(r.closing_price);
        if (!ticker || !date || !Number.isFinite(price) || price <= 0) continue;
        if (!map.has(ticker)) map.set(ticker, new Map());
        map.get(ticker)!.set(date, price);
      }
      return map;
    } catch (err) {
      if (isMissingSchemaError(err)) return new Map();
      throw err;
    }
  }

  /**
   * Converte o mapa { ticker → { date → price } } num callback (ticker, date) → number | undefined
   * compatível com PatrimonyMtmOptions.quoteForDate.
   * Para datas sem cotação exata devolve a cotação mais recente disponível antes da data.
   */
  buildQuoteForDateFn(
    quoteMap: Map<string, Map<string, number>>
  ): (ticker: string, date: string) => number | undefined {
    return (ticker: string, date: string): number | undefined => {
      const byDate = quoteMap.get(ticker.toUpperCase());
      if (!byDate || byDate.size === 0) return undefined;
      // Cotação exata
      const exact = byDate.get(date);
      if (exact !== undefined) return exact;
      // Cotação mais recente antes da data (fallback para feriados / fins de semana)
      let best: number | undefined;
      let bestDate = '';
      for (const [d, p] of byDate) {
        if (d <= date && d > bestDate) {
          bestDate = d;
          best = p;
        }
      }
      return best;
    };
  }

  /**
   * Mapa { ticker → último preço disponível } para o dia mais recente em market_quotes_daily.
   * Equivalente ao antigo invest_position_ext.last_price, mas global.
   */
  async loadLatestQuoteMap(
    ctx: UserContext,
    tickers: string[]
  ): Promise<Map<string, { price: number; date: string }>> {
    const result = new Map<string, { price: number; date: string }>();
    for (const ticker of tickers) {
      const row = await this.getQuoteOnOrBefore(ctx, ticker, new Date().toISOString().slice(0, 10));
      if (row) result.set(ticker.toUpperCase(), { price: row.closing_price, date: row.quote_date });
    }
    return result;
  }

  /**
   * Lista todos os tickers de ações/FIIs/ETF/BDR ativos em qualquer cliente.
   * Requer escopo global (rodar via authBootstrapContext em scripts/jobs).
   */
  async listTickersInUse(ctx: UserContext): Promise<string[]> {
    const rows = await this.gateway.readQuery(ctx, 'market_distinct_tickers_in_use', []);
    const out = new Set<string>();
    for (const r of rows) {
      const ticker = String(r.ticker || '').toUpperCase();
      if (ticker) out.add(ticker);
    }
    return [...out];
  }
}
