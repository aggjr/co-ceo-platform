import type { CoCeoDataGateway } from '../dal';
import { SYSTEM_INSTALLER_USER_ID } from '../dal/types';

export type OptionMarketRow = {
  ticker: string;
  underlyingTicker: string;
  optionType: 'CALL' | 'PUT';
  strikePrice: number;
  expirationDate: string;
};

const globalCatalogCtx = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: null,
  impersonatorId: null,
  scope: 'global' as const,
};

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function rowToMarketEntry(row: Record<string, unknown>): OptionMarketRow | null {
  const ticker = String(row.ticker ?? '').toUpperCase();
  if (!ticker) return null;
  const strike = Number(row.strike_price);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return {
    ticker,
    underlyingTicker: String(row.underlying_ticker ?? '').toUpperCase(),
    optionType:
      String(row.option_type ?? row.type ?? 'PUT').toUpperCase() === 'CALL' ? 'CALL' : 'PUT',
    strikePrice: strike,
    expirationDate: toIsoDate(row.expiration_date),
  };
}

/**
 * Catálogo de strikes (invest_options_market) para tickers em custódia aberta da org.
 * Antes usava findWhere({},) — DAL rejeita filtros vazios e o catch deixava o mapa sempre vazio.
 */
export async function loadOptionMarketCatalog(
  gateway: CoCeoDataGateway,
  organizationId: string
): Promise<Map<string, OptionMarketRow>> {
  const map = new Map<string, OptionMarketRow>();
  try {
    const rows = await gateway.readQuery(
      globalCatalogCtx,
      'invest_options_market_for_org',
      [organizationId]
    );
    for (const row of rows) {
      const entry = rowToMarketEntry(row);
      if (entry && !map.has(entry.ticker)) map.set(entry.ticker, entry);
    }
  } catch {
    /* migration / tabela ausente */
  }
  return map;
}

/**
 * Mapa ticker de opção → underlying para pivot e agregações.
 * Fontes: invest_options_market (org) e market_instruments (global).
 */
export async function loadOptionUnderlyingMap(
  gateway: CoCeoDataGateway,
  organizationId: string,
  optionTickers: string[] = []
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const marketCatalog = await loadOptionMarketCatalog(gateway, organizationId);
  for (const [ticker, row] of marketCatalog) {
    if (row.underlyingTicker) map.set(ticker, row.underlyingTicker);
  }

  const missing = [
    ...new Set(optionTickers.map((t) => t.toUpperCase()).filter(Boolean)),
  ].filter((t) => !map.has(t));

  for (const ticker of missing) {
    try {
      const rows = await gateway.findWhere(
        globalCatalogCtx,
        'market_instruments',
        { ticker },
        { limit: 1 }
      );
      const underlying = String(rows[0]?.underlying_ticker ?? '').toUpperCase();
      if (underlying) map.set(ticker, underlying);
    } catch {
      /* migration / tabela ausente */
    }
  }

  return map;
}
