/**
 * Meses BTG 2026 com extrato + pasta de notas (Drive / BTG_SOURCES_DIR).
 */
import fs from 'fs';
import path from 'path';

export type BtgMonthSpec = {
  month: string;
  extractFile: string;
  notesDirName: string;
  label: string;
};

export const BTG_MONTHS_2026: BtgMonthSpec[] = [
  { month: '2026-01', extractFile: 'Jan_2026.pdf', notesDirName: '004176105_20260101_20260131', label: 'Jan/2026' },
  { month: '2026-02', extractFile: 'Fev_2026.pdf', notesDirName: '004176105_20260201_20260228', label: 'Fev/2026' },
  { month: '2026-03', extractFile: 'Mar_2026.pdf', notesDirName: '004176105_20260301_20260331', label: 'Mar/2026' },
  { month: '2026-04', extractFile: 'Abr_2026.pdf', notesDirName: '004176105_20260401_20260430', label: 'Abr/2026' },
  { month: '2026-05', extractFile: 'Mai_2026.pdf', notesDirName: '004176105_20260426_20260525', label: 'Mai/2026' },
];

export function btgSourcesBase(): string {
  return process.env.BTG_SOURCES_DIR || path.join('G:', 'Meu Drive', '01 - Nova Estrutura');
}

export function notesBase(base = btgSourcesBase()): string {
  return path.join(base, 'Notas Corretagem');
}

/** Resolve pasta de notas quando o sufixo do ZIP BTG varia (ex. maio). */
export function resolveNotesDir(base: string, spec: BtgMonthSpec): string | null {
  const direct = path.join(notesBase(base), spec.notesDirName);
  if (fs.existsSync(direct)) return direct;

  const [y, m] = spec.month.split('-');
  const ym = `${y}${m}`;
  const root = notesBase(base);
  if (!fs.existsSync(root)) return null;

  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith('004176105_')) continue;
    const full = path.join(root, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const match = name.match(/^004176105_(\d{8})_(\d{8})$/);
    if (!match) continue;
    const startYm = match[1]!.slice(0, 6);
    const endYm = match[2]!.slice(0, 6);
    if (startYm <= ym && endYm >= ym) return full;
  }
  return null;
}

export function resolveExtractPath(base: string, spec: BtgMonthSpec): string {
  return path.join(base, spec.extractFile);
}

export function listNotePdfs(notesDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(notesDir)) return out;
  for (const ent of fs.readdirSync(notesDir, { withFileTypes: true })) {
    const full = path.join(notesDir, ent.name);
    if (ent.isDirectory()) out.push(...listNotePdfs(full));
    else if (/\.pdf$/i.test(ent.name) && !/summary\.pdf$/i.test(ent.name)) out.push(full);
  }
  return out;
}
