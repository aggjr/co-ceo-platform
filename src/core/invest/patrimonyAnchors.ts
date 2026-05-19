import fs from 'fs';
import path from 'path';

export type PatrimonyAnchorFile = {
  month_ends: Array<{ date: string; patrimony: number }>;
  fixed_income_total?: number;
};

let cached: PatrimonyAnchorFile | null = null;

export function loadPatrimonyAnchors(): PatrimonyAnchorFile {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), 'data/invest/btg-patrimony-anchors-2026.json');
  cached = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PatrimonyAnchorFile;
  return cached;
}

/** Patrimônio alvo BTG com interpolação linear entre âncoras mensais. */
export function interpolatePatrimonyTarget(date: string, anchors?: PatrimonyAnchorFile): number {
  const data = anchors ?? loadPatrimonyAnchors();
  const points = [...data.month_ends].sort((a, b) => a.date.localeCompare(b.date));
  const d = date.slice(0, 10);
  if (d <= points[0]!.date) return points[0]!.patrimony;
  const last = points[points.length - 1]!;
  if (d >= last.date) return last.patrimony;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (d >= a.date && d <= b.date) {
      const ta = new Date(`${a.date}T12:00:00Z`).getTime();
      const tb = new Date(`${b.date}T12:00:00Z`).getTime();
      const td = new Date(`${d}T12:00:00Z`).getTime();
      const w = tb === ta ? 0 : (td - ta) / (tb - ta);
      return a.patrimony + w * (b.patrimony - a.patrimony);
    }
  }
  return last.patrimony;
}
