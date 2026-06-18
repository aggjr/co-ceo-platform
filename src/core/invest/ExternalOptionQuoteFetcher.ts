import { fetchExternalOptionQuoteForDate } from './opcoesNetQuotes';

export type ExternalOptionQuote = {
  ticker: string;
  quoteDate: string;
  closingPrice: number | null;
  status: 'FOUND' | 'NOT_FOUND';
  source: string;
};

export class ExternalOptionQuoteFetcher {
  constructor(private gateway: unknown) {}

  /**
   * Busca cotação histórica da opção: opcoes.net primeiro, depois fontes web alternativas.
   */
  async fetchOptionQuote(ticker: string, date: string): Promise<ExternalOptionQuote> {
    const cached = await this.getCached(ticker, date);
    if (cached) return cached;

    const hit = await fetchExternalOptionQuoteForDate(ticker, date);
    const result: ExternalOptionQuote = hit
      ? {
          ticker: hit.ticker,
          quoteDate: hit.asOf,
          closingPrice: hit.price,
          status: 'FOUND',
          source: hit.provider ?? hit.source,
        }
      : {
          ticker: ticker.trim().toUpperCase(),
          quoteDate: date.slice(0, 10),
          closingPrice: null,
          status: 'NOT_FOUND',
          source: 'none',
        };

    await this.saveCache(result);
    return result;
  }

  private async getCached(ticker: string, date: string): Promise<ExternalOptionQuote | null> {
    const pool = (this.gateway as { pool?: { getConnection: () => Promise<unknown> } }).pool;
    if (!pool) return null;
    const conn = (await pool.getConnection()) as {
      query: (sql: string, params: unknown[]) => Promise<[Array<Record<string, unknown>>]>;
      release: () => void;
    };
    try {
      const [rows] = await conn.query(
        'SELECT * FROM invest_options_fetch_cache WHERE ticker = ? AND quote_date = ?',
        [ticker, date]
      );
      if (rows && rows.length > 0) {
        const row = rows[0]!;
        return {
          ticker: String(row.ticker),
          quoteDate: String(row.quote_date),
          closingPrice: row.closing_price != null ? Number(row.closing_price) : null,
          status: row.status as 'FOUND' | 'NOT_FOUND',
          source: String(row.source),
        };
      }
      return null;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'ER_NO_SUCH_TABLE') {
        console.error(`Error querying invest_options_fetch_cache: ${(err as Error).message}`);
      }
      return null;
    } finally {
      conn.release();
    }
  }

  private async saveCache(quote: ExternalOptionQuote): Promise<void> {
    const pool = (this.gateway as { pool?: { getConnection: () => Promise<unknown> } }).pool;
    if (!pool) return;
    const conn = (await pool.getConnection()) as {
      query: (sql: string, params: unknown[]) => Promise<unknown>;
      release: () => void;
    };
    try {
      await conn.query(
        `INSERT INTO invest_options_fetch_cache (ticker, quote_date, fetch_date, closing_price, status, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE closing_price = VALUES(closing_price), status = VALUES(status), source = VALUES(source), fetch_date = VALUES(fetch_date)`,
        [
          quote.ticker,
          quote.quoteDate,
          new Date().toISOString().slice(0, 10),
          quote.closingPrice,
          quote.status,
          quote.source,
        ]
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'ER_NO_SUCH_TABLE') {
        console.error(`Error saving to invest_options_fetch_cache: ${(err as Error).message}`);
      }
    } finally {
      conn.release();
    }
  }
}
