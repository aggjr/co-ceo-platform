import type { CoCeoDataGateway, SecurePayload, UserContext } from '../dal';
import type { ParsedOptionMarketRow } from './opcoesNetChainParser';

export type UpsertOptionMarketResult = {
  inserted: number;
  updated: number;
};

/**
 * Cache global invest_options_market (strike/dividendos ajustados — fonte opcoes.net).
 */
export class OptionMarketRepository {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async upsertMany(
    ctx: UserContext,
    rows: ParsedOptionMarketRow[]
  ): Promise<UpsertOptionMarketResult> {
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const ticker = row.ticker.trim().toUpperCase();
      if (!ticker) continue;

      const existing = await this.gateway.findWhere(
        ctx,
        'invest_options_market',
        { ticker },
        { limit: 1, columns: ['ticker'] }
      );

      const payload: SecurePayload = {
        ticker,
        underlying_ticker: row.underlyingTicker,
        option_type: row.optionType,
        strike_price: row.strikePrice,
        expiration_date: row.expirationDate,
        european_american: row.europeanAmerican,
      };

      if (existing[0]) {
        await this.gateway.update(ctx, 'invest_options_market', ticker, payload);
        updated += 1;
      } else {
        await this.gateway.insert(ctx, 'invest_options_market', payload);
        inserted += 1;
      }
    }

    return { inserted, updated };
  }
}
