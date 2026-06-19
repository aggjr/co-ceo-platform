/**
 * Carrega fechamentos mensais e snapshot da pasta co_ceo_platform (dados).
 */
import fs from 'fs';
import path from 'path';
import { btgDadosDir } from './btg-2026-months';

export type MonthlyCloseRecord = {
  file: string;
  month: string;
  date: string;
  patrimonio_inicial: number;
  patrimonio_final: number;
  rendimentos: number;
  aportes_retiradas: number;
  impostos: number;
};

export type PatrimonySnapshotRecord = {
  file: string;
  date: string;
  total: number;
  components: Record<string, unknown>;
};

function monthLastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0, 12)).toISOString().slice(0, 10);
}

function findMonthlyDir(dadosRoot: string): string {
  if (!fs.existsSync(dadosRoot)) {
    throw new Error(`Pasta (dados) não encontrada: ${dadosRoot}`);
  }
  const hit = fs.readdirSync(dadosRoot, { withFileTypes: true }).find((d) => {
    if (!d.isDirectory()) return false;
    const n = d.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return n.includes('dados patrimonio mensal');
  });
  if (!hit) throw new Error(`Subpasta Dados Patrimônio Mensal ausente em ${dadosRoot}`);
  return path.join(dadosRoot, hit.name);
}

export function loadMonthlyClosesFromDados(dadosRoot = btgDadosDir()): MonthlyCloseRecord[] {
  const dir = findMonthlyDir(dadosRoot);
  const files = ['JAN_2026.json', 'FEV_2026.json', 'MAR_2026.json', 'ABR_2026.json', 'MAI_2026.json', 'JUN_2026.json'];
  const out: MonthlyCloseRecord[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as Record<string, unknown>;
    const month = String(raw.mes ?? '').slice(0, 7);
    out.push({
      file,
      month,
      date: monthLastDay(month),
      patrimonio_inicial: Number(raw.patrimonio_inicial ?? 0),
      patrimonio_final: Number(raw.patrimonio_final ?? 0),
      rendimentos: Number(raw.rendimentos ?? 0),
      aportes_retiradas: Number(raw.aportes_retiradas ?? 0),
      impostos: Number(raw.impostos ?? 0),
    });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export function loadSnapshotFromDados(dadosRoot = btgDadosDir()): PatrimonySnapshotRecord | null {
  const dir = findMonthlyDir(dadosRoot);
  const candidates = fs
    .readdirSync(dir)
    .filter((n) => /^carteira_atualizada.*\.json$/i.test(n) || n.toLowerCase() === 'carteira atualizada.json');
  if (!candidates.length) return null;
  const file = candidates.sort().reverse()[0]!;
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<string, any>;
  return {
    file,
    date: String(raw.data_referencia ?? '').slice(0, 10),
    total: Number(raw.patrimonio?.total ?? 0),
    components: raw.patrimonio ?? {},
  };
}

/** Âncoras para invest_patrimony_monthly_anchors (aberturas + fechamentos). */
export function buildAnchorFileFromDados(dadosRoot = btgDadosDir()): {
  month_ends: Array<{ date: string; patrimony: number }>;
  fixed_income_total: number;
} {
  const closes = loadMonthlyClosesFromDados(dadosRoot);
  const snapshot = loadSnapshotFromDados(dadosRoot);
  const month_ends: Array<{ date: string; patrimony: number }> = [];

  if (closes.length) {
    const first = closes[0]!;
    month_ends.push({ date: '2025-12-31', patrimony: first.patrimonio_inicial });
    month_ends.push({ date: '2026-01-01', patrimony: first.patrimonio_inicial });
  }

  for (const row of closes) {
    month_ends.push({ date: `${row.month}-01`, patrimony: row.patrimonio_inicial });
    if (row.month !== '2026-06') {
      month_ends.push({ date: row.date, patrimony: row.patrimonio_final });
    }
  }

  if (snapshot?.date && snapshot.total > 0) {
    month_ends.push({ date: snapshot.date, patrimony: snapshot.total });
  }

  const dedup = new Map<string, number>();
  for (const p of month_ends) dedup.set(p.date, p.patrimony);

  const rf = Number((snapshot?.components as { renda_fixa?: { valor?: number } })?.renda_fixa?.valor ?? 0);

  return {
    month_ends: [...dedup.entries()]
      .map(([date, patrimony]) => ({ date, patrimony }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    fixed_income_total: rf > 0 ? rf : 208_292.9,
  };
}
