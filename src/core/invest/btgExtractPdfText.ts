/**
 * Normaliza texto de extrato BTG extraído de PDF (linhas quebradas, débito/crédito colados).
 * Saída no formato esperado por parseBtgMovementLine (saldo + tab + movimento).
 */

import { parseBrNumber } from './BtgExtractLineParser';

const DATE_LINE = /^(\d{2})\/(\d{2})\/(\d{4})\s*(.*)$/;
const BR_AMOUNT = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

export function extractBrAmountsFromGluedLine(line: string): number[] {
  return [...line.matchAll(BR_AMOUNT)].map((m) => parseBrNumber(m[0]));
}

/** Dado saldo anterior, identifica qual par é (saldo após, valor do lançamento). */
export function resolveBalanceAndMovement(
  previousBalance: number,
  amounts: [number, number]
): { balance: number; movement: number } {
  const [a, b] = amounts;
  const tol = 0.02;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);

  /** Grande saída: saldo residual (lo) após débito (hi) maior que o saldo anterior. */
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;

  if (
    lo > 50 &&
    lo < previousBalance * 0.01 &&
    hi > previousBalance * 0.5 &&
    hi > lo * 10 &&
    near(Math.abs(previousBalance - lo), hi)
  ) {
    return { balance: lo, movement: hi };
  }
  if (hi < previousBalance && near(Math.abs(previousBalance - hi), lo)) {
    return { balance: hi, movement: lo };
  }
  if (hi > previousBalance && near(Math.abs(hi - previousBalance), lo)) {
    return { balance: hi, movement: lo };
  }

  if (a >= b) return { balance: a, movement: b };
  return { balance: b, movement: a };
}

function formatBr(n: number): string {
  const neg = n < 0;
  const v = Math.abs(n);
  const [intPart, dec] = v.toFixed(2).split('.');
  const withDots = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${withDots},${dec}`;
}

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^\d de \d+$/.test(t)) return true;
  if (/^(Extrato|Conta Corrente|Período|Emitido|AUGUSTO|CPF:|Conta Corrente:|Agência:|Banco:|Informações|SAC|Ouvidoria|DataDescrição)/i.test(t)) {
    return true;
  }
  if (/^Total de (Créditos|Débitos)/i.test(t)) return true;
  if (/^1\.665\.|^1\.613\.|^6\.397,36Saldo Final/.test(t)) return true;
  return false;
}

/**
 * Converte texto cru do pdf-parse em bloco “Movimentação - Conta Corrente” normalizado.
 */
export function normalizeBtgExtractPdfText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [
    'Extrato de Conta Corrente',
    'Movimentação - Conta Corrente',
    'Data Descrição Débito Saldo\tCrédito',
  ];

  let prev: number | null = null;
  let pendingDesc: string | null = null;

  const flushPending = (amountLine: string) => {
    if (!pendingDesc || prev == null) return false;
    const amounts = extractBrAmountsFromGluedLine(amountLine);
    if (amounts.length !== 2) return false;
    const { balance, movement } = resolveBalanceAndMovement(prev, [
      amounts[0]!,
      amounts[1]!,
    ]);
    const dateMatch = pendingDesc.match(DATE_LINE);
    if (!dateMatch) return false;
    const [, dd, mm, yyyy, rest] = dateMatch;
    const description = rest.trim();
    out.push(
      `${dd}/${mm}/${yyyy} ${description} ${formatBr(balance)}\t${formatBr(movement)}`
    );
    prev = balance;
    pendingDesc = null;
    return true;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (isNoiseLine(line)) continue;

    if (/Saldo Inicial/i.test(line)) {
      const amounts = extractBrAmountsFromGluedLine(line);
      const opening = amounts[0];
      if (opening != null) {
        prev = opening;
        out.push(`Saldo Inicial ${formatBr(opening)}`);
      }
      pendingDesc = null;
      continue;
    }

    if (line.startsWith('Total de')) break;

    const dateMatch = line.match(DATE_LINE);
    if (dateMatch) {
      const amounts = extractBrAmountsFromGluedLine(line);
      if (amounts.length >= 2 && prev != null) {
        const rest = dateMatch[4]!.replace(BR_AMOUNT, '').trim();
        const { balance, movement } = resolveBalanceAndMovement(prev, [
          amounts[amounts.length - 2]!,
          amounts[amounts.length - 1]!,
        ]);
        const [, dd, mm, yyyy] = dateMatch;
        out.push(
          `${dd}/${mm}/${yyyy} ${rest} ${formatBr(balance)}\t${formatBr(movement)}`
        );
        prev = balance;
        pendingDesc = null;
        continue;
      }
      pendingDesc = line;
      continue;
    }

    const amounts = extractBrAmountsFromGluedLine(line);
    if (amounts.length === 2 && pendingDesc) {
      flushPending(line);
      continue;
    }
  }

  return out.join('\n');
}
