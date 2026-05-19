/** 3ª sexta do mês (aproximação vencimento opções B3). */
export function thirdFridayOfMonth(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  let fridays = 0;
  const d = new Date(first);
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === 5) fridays += 1;
    if (fridays === 3) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return `${year}-${String(month).padStart(2, '0')}-15`;
}

/**
 * Vencimento aproximado pelo código de mês no ticker (5ª letra).
 * PUT: M=jan … X=dez (padrão B3). CALL: A=jan … L=dez.
 */
const PUT_MONTH: Record<string, number> = {
  M: 1,
  N: 2,
  O: 3,
  P: 4,
  Q: 5,
  R: 6,
  S: 7,
  T: 8,
  U: 9,
  V: 10,
  W: 11,
  X: 12,
};

const CALL_MONTH: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  I: 9,
  J: 10,
  K: 11,
  L: 12,
};

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export type OptionMonthInfo = {
  letter: string;
  month: number;
  monthName: string;
  optionSide: 'call' | 'put';
};

/** 5ª letra do ticker B3 → mês de vencimento (tabela Call A–L / Put M–X). */
export function inferOptionMonthFromTicker(ticker: string): OptionMonthInfo | null {
  const t = ticker.trim().toUpperCase().replace(/[EF]$/, '');
  if (t.length < 5) return null;
  const letter = t.charAt(4);
  if (letter >= 'A' && letter <= 'L') {
    const month = CALL_MONTH[letter];
    if (!month) return null;
    return {
      letter,
      month,
      monthName: MONTH_NAMES_PT[month - 1]!,
      optionSide: 'call',
    };
  }
  if (letter >= 'M' && letter <= 'X') {
    const month = PUT_MONTH[letter];
    if (!month) return null;
    return {
      letter,
      month,
      monthName: MONTH_NAMES_PT[month - 1]!,
      optionSide: 'put',
    };
  }
  return null;
}

export function inferOptionExpiryDate(ticker: string, tradeYear = 2026): string {
  const info = inferOptionMonthFromTicker(ticker);
  if (!info) return `${tradeYear}-06-19`;
  let year = tradeYear;
  if (info.month <= 6 && tradeYear >= 2026) year = tradeYear;
  return thirdFridayOfMonth(year, info.month);
}

/** Data local YYYY-MM-DD (comparação de vencimento). */
export function localTodayIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Vencimento estritamente anterior ao dia de referência. */
export function isOptionExpired(
  expiryIso: string | null | undefined,
  asOfDate = localTodayIso()
): boolean {
  if (!expiryIso || String(expiryIso).startsWith('0000')) return false;
  const expiry = String(expiryIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false;
  return expiry < asOfDate;
}

/**
 * @deprecated Sufixo do ticker B3 ≠ strike efetivo (ex.: ITUBR416 → 37,90; PRIOR407 → 40,75).
 * Use metadata `option_strike` ou importação do Profit/BTG. Mantido só para testes legados.
 */
export function inferOptionStrikeFromTicker(ticker: string): number | null {
  const t = ticker.trim().toUpperCase().replace(/[EF]$/, '');
  const digits = t.slice(5).match(/^(\d+)/);
  if (!digits) return null;
  const n = parseInt(digits[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return Math.round((n / 100) * 10000) / 10000;
  if (n >= 100) return Math.round((n / 10) * 10000) / 10000;
  return Math.round((n / 100) * 10000) / 10000;
}
