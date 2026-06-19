/**
 * Meses BTG 2026 — extratos + notas.
 *
 * Layout canônico (pasta co_ceo_platform (dados)):
 *   Extratos Financeiros/Jan_2026.pdf
 *   Notas de Corretagem/004176105_YYYYMMDD_YYYYMMDD/...
 *
 * Override: BTG_DADOS_DIR ou BTG_SOURCES_DIR
 */
import fs from 'fs';
import path from 'path';
import type { BtgUploadFileInput } from '../../src/core/invest/btgUploadImportService';

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
  { month: '2026-05', extractFile: 'Mai_2026.pdf', notesDirName: '004176105_20260501_20260531', label: 'Mai/2026' },
  { month: '2026-06', extractFile: 'Jun_2026.pdf', notesDirName: '004176105_20260601_20260616', label: 'Jun/2026' },
];

const DEFAULT_DADOS_DIR = path.join(process.cwd(), 'Dados do Homebroker');

/** Pasta raiz `(dados)` com extratos, notas e JSON patrimônio. */
export function btgDadosDir(): string {
  return process.env.BTG_DADOS_DIR || DEFAULT_DADOS_DIR;
}

/** Base para resolve de paths — prefere `(dados)` quando existir. */
export function btgSourcesBase(): string {
  if (process.env.BTG_SOURCES_DIR) return process.env.BTG_SOURCES_DIR;
  const dados = btgDadosDir();
  if (fs.existsSync(dados)) return dados;
  return path.join('G:', 'Meu Drive', '01 - Nova Estrutura');
}

export function extractsDir(base = btgSourcesBase()): string {
  const nested = path.join(base, 'Extratos Financeiros');
  if (fs.existsSync(nested)) return nested;
  return base;
}

export function notesBase(base = btgSourcesBase()): string {
  const nested = path.join(base, 'Notas de Corretagem');
  if (fs.existsSync(nested)) return nested;
  const legacy = path.join(base, 'Notas Corretagem');
  if (fs.existsSync(legacy)) return legacy;
  return nested;
}

/** Resolve pasta de notas quando o sufixo do ZIP BTG varia (ex. maio/jun). */
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
  return path.join(extractsDir(base), spec.extractFile);
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

/** Todos os PDFs de notas (recursivo) — resolveNoteFilesForMonth filtra por mês. */
export function listAllNoteUploads(base = btgSourcesBase()): BtgUploadFileInput[] {
  const root = notesBase(base);
  return listNotePdfs(root).map((p) => ({
    name: path.relative(root, p).replace(/\\/g, '/'),
    contentBase64: fs.readFileSync(p).toString('base64'),
  }));
}

export function verifyBtgDadosLayout(base = btgSourcesBase()): {
  ok: boolean;
  base: string;
  missing: string[];
  noteCount: number;
} {
  const missing: string[] = [];
  const extDir = extractsDir(base);
  if (!fs.existsSync(base)) missing.push(`pasta raiz: ${base}`);
  for (const spec of BTG_MONTHS_2026) {
    const extractPath = resolveExtractPath(base, spec);
    if (!fs.existsSync(extractPath)) missing.push(`extrato ${spec.label}: ${extractPath}`);
    if (!resolveNotesDir(base, spec)) missing.push(`notas ${spec.label}`);
  }
  const noteCount = listNotePdfs(notesBase(base)).length;
  if (noteCount === 0) missing.push('nenhum PDF de nota encontrado');
  return { ok: missing.length === 0, base, missing, noteCount };
}

