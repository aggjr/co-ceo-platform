/**
 * Normaliza texto de extrato BTG extraído de PDF (linhas quebradas, débito/crédito colados).
 * Saída no formato esperado por parseBtgMovementLine (saldo + tab + movimento).
 */

import { parseBrNumber } from './BtgExtractLineParser';

const DATE_LINE = /^(\d{2})\/(\d{2})\/(\d{4})\s*(.*)$/;
// Sinal negativo opcional ANTES do numero. Saldo do BTG fica negativo quando a
// compra (ex. exercicio de PUT vendida) excede o caixa disponivel.
const BR_AMOUNT = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

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
  const near = (x: number, y: number) => Math.abs(x - y) <= tol;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);

  // Caso ambíguo: a + b ≈ previousBalance significa que prev = saldo + movimento (saída).
  // Dois cenários se confundem aqui:
  //   1) Taxa/IRRF pequeno: hi ≈ prev, lo é o valor da taxa (pequeno em absoluto).
  //   2) Grande saída (compra TD, transferência): saldo cai para lo (pode ser pequeno
  //      relativamente, ex. R$ 2.765 de R$ 455k), movimento foi hi.
  // Heurística: classifica como taxa pequena quando hi/prev > 0.999 OU lo < 100
  // (taxas costumam ser de poucos reais; grandes saídas deixam resíduo de centenas/milhares).
  if (near(a + b, previousBalance) && previousBalance > 0) {
    const hiRatio = hi / previousBalance;
    if (hiRatio > 0.999 || lo < 100) {
      return { balance: hi, movement: lo };
    }
    return { balance: lo, movement: hi };
  }

  // a = saldo após, b = movimento: |prev - a| ≈ b
  const fitA = near(Math.abs(previousBalance - a), b);
  // b = saldo após, a = movimento: |prev - b| ≈ a
  const fitB = near(Math.abs(previousBalance - b), a);

  if (fitA && !fitB) return { balance: a, movement: b };
  if (fitB && !fitA) return { balance: b, movement: a };

  // Fallback: assume o maior como saldo (cenário comum de pequenos movimentos).
  return { balance: hi, movement: lo };
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

type RawTuple = {
  dd: string;
  mm: string;
  yyyy: string;
  description: string;
  amounts: [number, number];
};

type Resolution = { balance: number; movement: number };

/**
 * Resolve toda a sequência de tuplas via backtracking: para cada tupla, tenta
 * as hipóteses (balance=a, mov=b) e (balance=b, mov=a) que satisfazem
 * |prev - balance| ≈ mov. Se ambas batem (a + b ≈ prev), explora as duas
 * recursivamente — a primeira ramificação que chega ao fim sem inconsistência vence.
 * Cai num fallback heurístico se nenhuma cadeia se completa.
 */
/**
 * Mede quantos passos à frente uma hipótese de saldo (prev) consegue avançar
 * antes de bater num impasse. Limita profundidade para evitar explosão.
 */
function chainLength(
  prev: number,
  tuples: RawTuple[],
  startIdx: number,
  maxDepth: number
): number {
  if (maxDepth === 0 || startIdx >= tuples.length) return 0;
  const tol = 0.02;
  const near = (x: number, y: number) => Math.abs(x - y) <= tol;
  const [a, b] = tuples[startIdx]!.amounts;
  const fitA = near(Math.abs(prev - a), b);
  const fitB = near(Math.abs(prev - b), a);
  if (!fitA && !fitB) return 0;
  if (fitA && !fitB) {
    return 1 + chainLength(a, tuples, startIdx + 1, maxDepth - 1);
  }
  if (fitB && !fitA) {
    return 1 + chainLength(b, tuples, startIdx + 1, maxDepth - 1);
  }
  // Ambíguo: maior dos dois ramos.
  const la = chainLength(a, tuples, startIdx + 1, maxDepth - 1);
  const lb = chainLength(b, tuples, startIdx + 1, maxDepth - 1);
  return 1 + Math.max(la, lb);
}

/**
 * Resolve a sequência inteira de tuplas. Para cada tupla, se a resolução for
 * ambígua (a + b ≈ prev), escolhe a hipótese cuja cadeia avança mais profundo
 * sem bater em impasse (lookahead com depth limitado).
 */
function resolveSequence(opening: number, tuples: RawTuple[]): Resolution[] {
  const tol = 0.02;
  const near = (x: number, y: number) => Math.abs(x - y) <= tol;
  const LOOKAHEAD = 10;

  const result: Resolution[] = [];
  let prev = opening;

  for (let i = 0; i < tuples.length; i++) {
    const [a, b] = tuples[i]!.amounts;
    const fitA = near(Math.abs(prev - a), b);
    const fitB = near(Math.abs(prev - b), a);

    let chosen: Resolution;
    if (fitA && !fitB) {
      chosen = { balance: a, movement: b };
    } else if (fitB && !fitA) {
      chosen = { balance: b, movement: a };
    } else if (fitA && fitB) {
      // Ambíguo — usa lookahead para diferenciar.
      const la = chainLength(a, tuples, i + 1, LOOKAHEAD);
      const lb = chainLength(b, tuples, i + 1, LOOKAHEAD);
      if (la >= lb) chosen = { balance: a, movement: b };
      else chosen = { balance: b, movement: a };
    } else {
      // Nem A nem B batem: cai no fallback heurístico.
      chosen = resolveBalanceAndMovement(prev, [a, b]);
    }
    result.push(chosen);
    prev = chosen.balance;
  }
  return result;
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

  let opening: number | null = null;
  const tuples: RawTuple[] = [];
  let pendingDesc: string | null = null;

  // ---- Passada 1: coleta todas as tuplas (data, descrição, [a, b]) sem resolver.
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (isNoiseLine(line)) continue;

    if (/Saldo Inicial/i.test(line)) {
      const amounts = extractBrAmountsFromGluedLine(line);
      if (amounts[0] != null) opening = amounts[0];
      pendingDesc = null;
      continue;
    }

    if (line.startsWith('Total de')) break;

    const dateMatch = line.match(DATE_LINE);
    if (dateMatch) {
      const amounts = extractBrAmountsFromGluedLine(line);
      if (amounts.length >= 2) {
        const rest = dateMatch[4]!.replace(BR_AMOUNT, '').trim();
        const [, dd, mm, yyyy] = dateMatch;
        tuples.push({
          dd: dd!,
          mm: mm!,
          yyyy: yyyy!,
          description: rest,
          amounts: [amounts[amounts.length - 2]!, amounts[amounts.length - 1]!],
        });
        pendingDesc = null;
        continue;
      }
      pendingDesc = line;
      continue;
    }

    const amounts = extractBrAmountsFromGluedLine(line);
    if (amounts.length === 2 && pendingDesc) {
      const dateMatch2 = pendingDesc.match(DATE_LINE);
      if (dateMatch2) {
        const [, dd, mm, yyyy, rest] = dateMatch2;
        tuples.push({
          dd: dd!,
          mm: mm!,
          yyyy: yyyy!,
          description: rest!.trim(),
          amounts: [amounts[0]!, amounts[1]!],
        });
      }
      pendingDesc = null;
    }
  }

  if (opening == null) return out.join('\n');
  out.push(`Saldo Inicial ${formatBr(opening)}`);

  // ---- Passada 2: resolve toda a sequência via backtracking com lookahead profundo.
  const resolutions = resolveSequence(opening, tuples);
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i]!;
    const r = resolutions[i]!;
    out.push(
      `${t.dd}/${t.mm}/${t.yyyy} ${t.description} ${formatBr(r.balance)}\t${formatBr(r.movement)}`
    );
  }

  return out.join('\n');
}
