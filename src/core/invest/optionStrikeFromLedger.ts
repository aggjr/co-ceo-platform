import type { LedgerEvent } from './CustodyEngine';
import { isOptionTicker } from './assetClassifier';

/** Extrai ticker da opção em notas de exercício BTG (ex.: "— PRIOP650E ("). */
export function parseOptionTickerFromExerciseNotes(notes: string): string | null {
  const text = String(notes || '');
  if (!/exerc/i.test(text)) return null;
  const afterDash = text.split(/\s[-\u2013\u2014]\s/);
  const tail = afterDash.length > 1 ? afterDash[afterDash.length - 1] : text;
  const m = /\b([A-Z]{4}[A-X][A-Z0-9]{0,6}E?)\s*\(/i.exec(tail);
  if (!m) return null;
  const ticker = m[1].replace(/E$/i, '').toUpperCase();
  return isOptionTicker(ticker) ? ticker : null;
}

/**
 * Strike observado em exercício: unit_price da aquisição do papel no exercício
 * corresponde ao strike da série (notas BTG citam o ticker da opção).
 */
export function buildOptionStrikeMapFromLedgerEvents(
  events: LedgerEvent[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events) {
    const notes = String(e.notes || '');
    if (!/exerc/i.test(notes)) continue;
    const optTicker = parseOptionTickerFromExerciseNotes(notes);
    if (!optTicker || !isOptionTicker(optTicker)) continue;
    const strike = Number(e.unit_price);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const rounded = Math.round(strike * 10000) / 10000;
    const prev = map.get(optTicker);
    if (prev == null || prev !== rounded) {
      map.set(optTicker, rounded);
    }
  }
  return map;
}
