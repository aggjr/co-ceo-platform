export type OptionStrikeSource = 'metadata' | 'market_catalog' | 'ledger_exercise' | null;

export type PortfolioStrikeMeta = {
  option_strike?: number | null;
  option_strike_as_of?: string | null;
};

function parseStrikeValue(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10000) / 10000;
}

export function strikeFromMetadata(meta: PortfolioStrikeMeta | null | undefined): number | null {
  if (!meta) return null;
  return parseStrikeValue(meta.option_strike);
}

/**
 * Strike vem da operação da opção no livro razão (gravada em metadata do ativo).
 * Nunca é inferido do ticker B3 nem lido de catálogo — sem operação, sem strike.
 */
export function resolveOptionStrike(input: {
  meta?: PortfolioStrikeMeta | null;
  ticker: string;
  marketStrike?: number | null;
  ledgerExerciseStrike?: number | null;
}): { strike: number | null; source: OptionStrikeSource } {
  const fromMeta = strikeFromMetadata(input.meta);
  if (fromMeta != null) return { strike: fromMeta, source: 'metadata' };
  const fromLedger = parseStrikeValue(input.ledgerExerciseStrike);
  if (fromLedger != null) return { strike: fromLedger, source: 'ledger_exercise' };
  const fromMarket = parseStrikeValue(input.marketStrike);
  if (fromMarket != null) return { strike: fromMarket, source: 'market_catalog' };
  return { strike: null, source: null };
}
