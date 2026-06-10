export type PatrimonyAnchorFile = {
  month_ends: Array<{ date: string; patrimony: number }>;
  fixed_income_total?: number;
};

type MonthlyCloseInput = {
  mes?: unknown;
  month?: unknown;
  patrimonio_inicial?: unknown;
  patrimonio_final?: unknown;
  initial_patrimony?: unknown;
  final_patrimony?: unknown;
  fixed_income_total?: unknown;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function monthLastDay(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0, 12));
  return date.toISOString().slice(0, 10);
}

function normalizePointDate(value: unknown): string | null {
  const date = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeMonthlyClose(raw: MonthlyCloseInput): PatrimonyAnchorFile | null {
  const month = String(raw.mes ?? raw.month ?? '').trim().slice(0, 7);
  const lastDay = monthLastDay(month);
  if (!lastDay) return null;

  const month_ends: PatrimonyAnchorFile['month_ends'] = [];
  const initial = parseNumber(raw.patrimonio_inicial ?? raw.initial_patrimony);
  const final = parseNumber(raw.patrimonio_final ?? raw.final_patrimony);
  if (initial != null) month_ends.push({ date: `${month}-01`, patrimony: initial });
  if (final != null) month_ends.push({ date: lastDay, patrimony: final });
  if (!month_ends.length) return null;

  const fixedIncome = parseNumber(raw.fixed_income_total);
  return {
    month_ends,
    ...(fixedIncome != null ? { fixed_income_total: fixedIncome } : {}),
  };
}

export function normalizePatrimonyAnchorInput(raw: unknown): PatrimonyAnchorFile | null {
  if (!raw) return null;

  if (Array.isArray(raw)) {
    const merged = new Map<string, number>();
    let fixedIncome: number | undefined;
    for (const item of raw) {
      const normalized = normalizePatrimonyAnchorInput(item);
      if (!normalized) continue;
      for (const point of normalized.month_ends) merged.set(point.date, point.patrimony);
      if (normalized.fixed_income_total != null) fixedIncome = normalized.fixed_income_total;
    }
    if (!merged.size) return null;
    return {
      month_ends: [...merged.entries()]
        .map(([date, patrimony]) => ({ date, patrimony }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      ...(fixedIncome != null ? { fixed_income_total: fixedIncome } : {}),
    };
  }

  if (typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const nested = doc.month_ends ?? doc.fechamentos ?? doc.monthly_closings ?? doc.months;
  if (Array.isArray(nested)) {
    const points = new Map<string, number>();
    for (const item of nested) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const date = normalizePointDate(row.date ?? row.reference_date ?? row.data);
      const patrimony = parseNumber(row.patrimony ?? row.patrimonio ?? row.patrimonio_final);
      if (date && patrimony != null) points.set(date, patrimony);
    }
    const normalizedNested = normalizePatrimonyAnchorInput(nested);
    for (const point of normalizedNested?.month_ends ?? []) points.set(point.date, point.patrimony);
    if (!points.size) return null;
    const fixedIncome = parseNumber(doc.fixed_income_total);
    const nestedFixedIncome = normalizedNested?.fixed_income_total;
    return {
      month_ends: [...points.entries()]
        .map(([date, patrimony]) => ({ date, patrimony }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      ...(fixedIncome != null
        ? { fixed_income_total: fixedIncome }
        : nestedFixedIncome != null
          ? { fixed_income_total: nestedFixedIncome }
          : {}),
    };
  }

  return normalizeMonthlyClose(doc);
}

/**
 * Legado para scripts sem contexto de organização.
 * Preferir {@link PatrimonyMonthlyAnchorsRepository.loadForOrganization}.
 */
export function loadPatrimonyAnchors(): PatrimonyAnchorFile {
  return { month_ends: [], fixed_income_total: 0 };
}

/** Patrimônio alvo BTG com interpolação linear entre âncoras mensais (ajustado por fluxos). */
export function interpolatePatrimonyTarget(
  date: string,
  anchors?: PatrimonyAnchorFile,
  flowsByDate?: Map<string, number>
): number {
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

      let totalFlowsPeriod = 0;
      let flowsUpToDate = 0;
      if (flowsByDate) {
        for (const [day, flow] of flowsByDate) {
          if (day > a.date && day <= b.date) {
            totalFlowsPeriod += flow;
            if (day <= d) flowsUpToDate += flow;
          }
        }
      }

      const growthExFlow = b.patrimony - a.patrimony - totalFlowsPeriod;
      return a.patrimony + w * growthExFlow + flowsUpToDate;
    }
  }
  return last.patrimony;
}
