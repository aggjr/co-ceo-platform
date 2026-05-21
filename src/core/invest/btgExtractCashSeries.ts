/**
 * Série diária de saldo em conta corrente BTG a partir dos extratos (PDF → .txt).
 * Inclui LIQ BOLSA — o saldo do extrato reflete liquidações agregadas; o detalhe de bolsa vem do myProfit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseBtgMovementLine, parseBrNumber } from './BtgExtractLineParser';

const BR_NUMBER = /(\d{1,3}(?:\.\d{3})*,\d{2}|-\d{1,3}(?:\.\d{3})*,\d{2})/g;

export type BtgExtractCashPoint = {
  date: string;
  balance: number;
  description: string;
  movementAmount: number;
};

export type BtgExtractSourceSpec = {
  file: string;
  periodLabel: string;
  openingBalance?: number;
};

/** Extrato único jan–mai/2026 (PDF → Extrato-normalized.txt). Arquivos 1_2/3_4/6 mantidos só como referência. */
export const BTG_EXTRACT_SOURCES: BtgExtractSourceSpec[] = [
  { file: 'Extrato-normalized.txt', periodLabel: '2026-01..05' },
];

export function defaultBtgExtractDir(): string {
  return path.join(process.cwd(), 'data', 'invest', 'sources', 'btg-extracts');
}

export function extractMovementBlock(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes('Movimentação - Conta Corrente'));
  if (start < 0) return lines;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('Total de Créditos'));
  return end > start ? lines.slice(start, end) : lines.slice(start);
}

/** Todas as linhas com data → saldo após lançamento (inclui LIQ BOLSA). */
export function parseExtractCashSeries(
  lines: string[],
  openingBalance?: number
): BtgExtractCashPoint[] {
  const out: BtgExtractCashPoint[] = [];
  let prev: number | null = openingBalance ?? null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('Total de')) continue;

    if (line.startsWith('Saldo Inicial')) {
      const nums = [...line.matchAll(BR_NUMBER)].map((x) => parseBrNumber(x[1]!));
      if (nums[0] != null) {
        prev = nums[0];
        out.push({
          date: '',
          balance: nums[0],
          description: 'Saldo Inicial',
          movementAmount: 0,
        });
      }
      continue;
    }

    const parsed = parseBtgMovementLine(line, prev);
    if (!parsed) continue;
    prev = parsed.balance;
    out.push({
      date: parsed.date,
      balance: parsed.balance,
      description: parsed.description,
      movementAmount: parsed.movementAmount,
    });
  }

  return out.filter((p) => p.date);
}

export function loadBtgExtractCashDailySeries(
  srcDir: string = defaultBtgExtractDir()
): {
  sources: BtgExtractSourceSpec[];
  series: BtgExtractCashPoint[];
  byDate: Map<string, BtgExtractCashPoint>;
} {
  const series: BtgExtractCashPoint[] = [];

  for (const spec of BTG_EXTRACT_SOURCES) {
    const fp = path.join(srcDir, spec.file);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf8');
    const block = extractMovementBlock(text);
    series.push(...parseExtractCashSeries(block, spec.openingBalance));
  }

  series.sort((a, b) => a.date.localeCompare(b.date) || 0);
  const byDate = new Map<string, BtgExtractCashPoint>();
  for (const p of series) {
    byDate.set(p.date, p);
  }
  return { sources: BTG_EXTRACT_SOURCES, series, byDate };
}

export function lastExtractCashPoint(series: BtgExtractCashPoint[]): BtgExtractCashPoint | null {
  if (!series.length) return null;
  return series[series.length - 1]!;
}

export type ExtractTedRow = {
  date: string;
  amount: number;
  description: string;
};

export function listExtractTeds(series: BtgExtractCashPoint[]): ExtractTedRow[] {
  const rows: ExtractTedRow[] = [];
  for (const p of series) {
    const d = p.description.toUpperCase();
    if (!d.includes('TED ENVIADA') && !d.includes('TED RECEBIDA') && !d.includes('TED CREDITO')) {
      continue;
    }
    const isOut = d.includes('TED ENVIADA');
    rows.push({
      date: p.date,
      amount: isOut ? -Math.abs(p.movementAmount) : Math.abs(p.movementAmount),
      description: p.description,
    });
  }
  return rows;
}

export type MonthEndCashCheck = {
  date: string;
  extractBalance: number | null;
};

/** Último saldo do extrato em cada mês civil (ou null se sem movimento). */
export function monthEndExtractBalances(
  series: BtgExtractCashPoint[],
  months: string[]
): MonthEndCashCheck[] {
  const byMonth = new Map<string, BtgExtractCashPoint>();
  for (const p of series) {
    const m = p.date.slice(0, 7);
    const cur = byMonth.get(m);
    if (!cur || p.date >= cur.date) byMonth.set(m, p);
  }
  return months.map((month) => {
    const last = byMonth.get(month);
    const endDate =
      month === '2026-02'
        ? '2026-02-28'
        : month === '2026-04'
          ? '2026-04-30'
          : `${month}-31`;
    const point =
      last && last.date <= endDate
        ? last
        : [...series].reverse().find((p) => p.date.startsWith(month) && p.date <= endDate);
    return {
      date: point?.date ?? endDate,
      extractBalance: point?.balance ?? null,
    };
  });
}

export type ExtractReconciliationSummary = {
  extractFiles: string[];
  movementLines: number;
  firstDate: string | null;
  lastDate: string | null;
  lastExtractCashBalance: number | null;
  tedsInExtract: ExtractTedRow[];
  monthEndCash: MonthEndCashCheck[];
  note: string;
};

export function buildExtractReconciliationSummary(
  srcDir?: string
): ExtractReconciliationSummary {
  const { sources, series } = loadBtgExtractCashDailySeries(srcDir);
  const last = lastExtractCashPoint(series);
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

  return {
    extractFiles: sources.map((s) => s.file),
    movementLines: series.length,
    firstDate: series[0]?.date ?? null,
    lastDate: last?.date ?? null,
    lastExtractCashBalance: last?.balance ?? null,
    tedsInExtract: listExtractTeds(series),
    monthEndCash: monthEndExtractBalances(series, months),
    note:
      'Extrato BTG = conta corrente (saldo após cada lançamento). Patrimônio total da carteira usa âncoras Necton + custódia myProfit; rentabilidade TWR usa fechamentos mensais BTG.',
  };
}
