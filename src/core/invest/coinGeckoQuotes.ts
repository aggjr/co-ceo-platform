import type { CoCeoDataGateway } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';

export type CoinGeckoQuote = {
  ticker: string;
  providerSymbol: string;
  priceUsd: number;
  asOf: string;
  source: 'coingecko';
};

function toCoinGeckoDate(asOfDate: string): string {
  const [year, month, day] = asOfDate.slice(0, 10).split('-');
  return `${day}-${month}-${year}`;
}

async function resolveCoinGeckoId(
  gateway: CoCeoDataGateway,
  ticker: string
): Promise<string | null> {
  const ctx = authBootstrapContext();
  const rows = await gateway.readQuery(ctx, 'market_quote_source_mapping', [
    'coingecko',
    ticker.trim().toUpperCase(),
  ]);
  return rows[0]?.provider_symbol ? String(rows[0].provider_symbol) : null;
}

export async function fetchCoinGeckoQuote(
  gateway: CoCeoDataGateway,
  ticker: string,
  asOfDate: string
): Promise<CoinGeckoQuote | null> {
  const cleanTicker = ticker.trim().toUpperCase();
  const providerSymbol = await resolveCoinGeckoId(gateway, cleanTicker);
  if (!providerSymbol) return null;

  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(providerSymbol)}/history` +
    `?date=${toCoinGeckoDate(asOfDate)}&localization=false`;
  const headers: Record<string, string> = {};
  if (process.env.COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  }
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) return null;

  const data = await resp.json() as {
    market_data?: {
      current_price?: {
        usd?: number;
      };
    };
  };
  const priceUsd = Number(data.market_data?.current_price?.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  return {
    ticker: cleanTicker,
    providerSymbol,
    priceUsd,
    asOf: asOfDate.slice(0, 10),
    source: 'coingecko',
  };
}
