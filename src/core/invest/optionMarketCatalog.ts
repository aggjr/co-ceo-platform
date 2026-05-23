import type { CoCeoDataGateway } from '../dal';
import { SYSTEM_INSTALLER_USER_ID } from '../dal/types';

export type OptionMarketRow = {
  ticker: string;
  underlyingTicker: string;
  optionType: 'CALL' | 'PUT';
  strikePrice: number;
  expirationDate: string;
};

/** Cache global de mercado (invest_options_market ou legado invest_options_chain). */
export async function loadOptionMarketCatalog(
  gateway: CoCeoDataGateway
): Promise<Map<string, OptionMarketRow>> {
  const map = new Map<string, OptionMarketRow>();
  for (const table of ['invest_options_market', 'invest_options_chain'] as const) {
    try {
      const rows = await gateway.findWhere(
        {
          userId: SYSTEM_INSTALLER_USER_ID,
          organizationId: null,
          impersonatorId: null,
          scope: 'global',
        },
        table,
        {},
        { limit: 50_000 }
      );
      for (const row of rows) {
        const ticker = String(row.ticker ?? '').toUpperCase();
        if (!ticker || map.has(ticker)) continue;
        const strike = Number(row.strike_price);
        if (!Number.isFinite(strike) || strike <= 0) continue;
        map.set(ticker, {
          ticker,
          underlyingTicker: String(row.underlying_ticker ?? '').toUpperCase(),
          optionType: String(row.option_type ?? row.type ?? 'PUT').toUpperCase() === 'CALL' ? 'CALL' : 'PUT',
          strikePrice: strike,
          expirationDate: String(row.expiration_date ?? '').slice(0, 10),
        });
      }
    } catch {
      /* tabela pode não existir em bases antigas */
    }
  }
  return map;
}
