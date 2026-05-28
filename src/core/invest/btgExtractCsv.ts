/**
 * Converte export CSV do extrato BTG em linhas compatíveis com BtgExtractLineParser.
 */
import { parseBrNumber } from './BtgExtractLineParser';

function detectDelimiter(headerLine: string): string {
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semi >= comma ? ';' : ',';
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delim) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

function parseDateCell(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

function moneyCell(raw: string): number {
  const t = String(raw || '').trim();
  if (!t || t === '-' || t === '—') return 0;
  return parseBrNumber(t);
}

/**
 * CSV → linhas "DD/MM/YYYY descrição saldo movimento" para o parser BTG.
 */
export function btgExtractCsvToNormalizedLines(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delim = detectDelimiter(lines[0]!);
  const headers = splitCsvLine(lines[0]!, delim).map(normHeader);

  const idxDate = headers.findIndex((h) => h === 'data' || h.startsWith('data '));
  const idxDesc2 = headers.findIndex((h) => h.includes('descric') || h.includes('histor'));
  const idxDebit = headers.findIndex((h) => h.includes('debit'));
  const idxCredit = headers.findIndex((h) => h.includes('credit'));
  const idxBalance = headers.findIndex((h) => h === 'saldo' || h.startsWith('saldo'));

  if (idxDate < 0 || idxDesc2 < 0) {
    throw new Error('CSV sem colunas Data e Descrição reconhecidas.');
  }

  const out: string[] = ['Extrato de Conta Corrente', 'Movimentação - Conta Corrente'];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!, delim);
    const dateIso = parseDateCell(cols[idxDate] || '');
    if (!dateIso) {
      const saldoIni = (cols[idxDesc2] || '').match(/saldo\s+inicial/i);
      if (saldoIni && idxBalance >= 0) {
        out.push(`Saldo Inicial ${cols[idxBalance]}`);
      }
      continue;
    }
    const [yyyy, mm, dd] = dateIso.split('-');
    const desc = (cols[idxDesc2] || '').trim();
    const debit = idxDebit >= 0 ? moneyCell(cols[idxDebit]!) : 0;
    const credit = idxCredit >= 0 ? moneyCell(cols[idxCredit]!) : 0;
    const balance = idxBalance >= 0 ? moneyCell(cols[idxBalance]!) : 0;
    const movement = credit > 0 ? credit : debit > 0 ? debit : Math.abs(credit - debit);
    const br = (n: number) =>
      n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    out.push(`${dd}/${mm}/${yyyy} ${desc} ${br(balance)} ${br(movement)}`);
  }

  return out;
}
