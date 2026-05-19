import { inferAssetType, isOptionTicker } from './assetClassifier';
import { strikeFromCatalog } from './optionStrikeCatalog';

export type OptionStrikeSource = 'metadata' | 'catalog' | 'exercise' | null;

export type PortfolioStrikeMeta = {
  option_strike?: number | null;
  option_strike_as_of?: string | null;
};

function parseStrikeValue(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10000) / 10000;
}

/** Strike cadastrado em metadata do ativo (fonte confiável). */
export function strikeFromMetadata(meta: PortfolioStrikeMeta | null | undefined): number | null {
  if (!meta) return null;
  return parseStrikeValue(meta.option_strike);
}

/**
 * Strike em exercício/atribuição (ticker …E/…F e preço ≈ strike).
 * Não usa sufixo numérico do ticker B3 — na B3 o código ≠ strike efetivo.
 */
export function strikeFromExerciseHint(
  ticker: string,
  managerialAvgPrice: number
): number | null {
  const t = ticker.trim().toUpperCase();
  if (!/[EF]$/.test(t)) return null;
  const pm = Number(managerialAvgPrice);
  if (!Number.isFinite(pm) || pm < 5) return null;
  const base = t.replace(/[EF]$/, '');
  const kind = inferAssetType(base);
  if (kind !== 'option_call' && kind !== 'option_put' && !isOptionTicker(base)) return null;
  return parseStrikeValue(pm);
}

export function resolveOptionStrike(input: {
  meta?: PortfolioStrikeMeta | null;
  ticker: string;
  managerialAvgPrice?: number;
}): { strike: number | null; source: OptionStrikeSource } {
  const fromCatalog = strikeFromCatalog(input.ticker);
  if (fromCatalog != null) return { strike: fromCatalog, source: 'catalog' };

  const fromMeta = strikeFromMetadata(input.meta);
  if (fromMeta != null) return { strike: fromMeta, source: 'metadata' };

  const fromExercise = strikeFromExerciseHint(
    input.ticker,
    Number(input.managerialAvgPrice ?? 0)
  );
  if (fromExercise != null) return { strike: fromExercise, source: 'exercise' };

  return { strike: null, source: null };
}
