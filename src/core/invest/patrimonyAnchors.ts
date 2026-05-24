export type PatrimonyAnchorFile = {
  month_ends: Array<{ date: string; patrimony: number }>;
  fixed_income_total?: number;
};

/**
 * Legado para scripts sem contexto de organização.
 * Preferir {@link PatrimonyMonthlyAnchorsRepository.loadForOrganization}.
 */
export function loadPatrimonyAnchors(): PatrimonyAnchorFile {
  return { month_ends: [], fixed_income_total: 0 };
}

/** Patrimônio alvo BTG com interpolação linear entre âncoras mensais. */
export function interpolatePatrimonyTarget(date: string, anchors?: PatrimonyAnchorFile): number {
  const data = anchors ?? loadPatrimonyAnchors();
  const points = [...data.month_ends].sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0) return 0;
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
