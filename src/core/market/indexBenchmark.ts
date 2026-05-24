import type { MarketIndexRow } from './MarketQuoteRepository';

export type IndexLevelPoint = {
  date: string;
  level: number;
  dailyFactor: number;
  hadObservation: boolean;
};

/**
 * Série de nível indexado (base 100 no primeiro dia útil com dado em `from`).
 * Dias sem observação do índice mantêm o nível (sem accrual — ex.: fim de semana no CDI).
 */
export function buildIndexedLevelSeries(
  rows: Pick<MarketIndexRow, 'reference_date' | 'daily_factor'>[],
  from: string,
  to: string,
  baseLevel = 100
): IndexLevelPoint[] {
  const fromIso = from.slice(0, 10);
  const toIso = to.slice(0, 10);
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const d = r.reference_date.slice(0, 10);
    if (d >= fromIso && d <= toIso && Number.isFinite(r.daily_factor) && r.daily_factor > 0) {
      byDate.set(d, r.daily_factor);
    }
  }

  const out: IndexLevelPoint[] = [];
  let level = baseLevel;
  for (let cursor = fromIso; cursor <= toIso; cursor = addDays(cursor, 1)) {
    const factor = byDate.get(cursor);
    if (factor != null) level = level * factor;
    out.push({
      date: cursor,
      level: Math.round(level * 1_000_000) / 1_000_000,
      dailyFactor: factor ?? 1,
      hadObservation: factor != null,
    });
  }
  return out;
}

/** Rentabilidade acumulada no período (ex.: 0.0523 = 5,23%). */
export function periodReturnFromLevelSeries(series: IndexLevelPoint[]): number | null {
  if (series.length < 2) return null;
  const first = series[0]!.level;
  const last = series[series.length - 1]!.level;
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return null;
  return Math.round((last / first - 1) * 1_000_000) / 1_000_000;
}

/** Produto dos fatores diários entre duas datas inclusivas (somente dias com dado). */
export function compoundedFactor(
  rows: Pick<MarketIndexRow, 'reference_date' | 'daily_factor'>[],
  from: string,
  to: string
): number {
  const fromIso = from.slice(0, 10);
  const toIso = to.slice(0, 10);
  let product = 1;
  for (const r of rows) {
    const d = r.reference_date.slice(0, 10);
    if (d < fromIso || d > toIso) continue;
    if (Number.isFinite(r.daily_factor) && r.daily_factor > 0) product *= r.daily_factor;
  }
  return Math.round(product * 1_000_000_000_000) / 1_000_000_000_000;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type BenchmarkChartPoint = {
  date: string;
  indexedLevel: number;
  /** Retorno acumulado desde o início do período (decimal). */
  periodReturnToDate: number;
  dailyFactor: number | null;
};

export type CdiBenchmarkPayload = {
  available: boolean;
  indexCode: string;
  observationDays: number;
  periodReturn: number | null;
  series: BenchmarkChartPoint[];
};

/** Alinha CDI às mesmas datas da curva de patrimônio (para Chart.js). */
export function buildCdiBenchmarkForChart(
  rows: Pick<MarketIndexRow, 'reference_date' | 'daily_factor'>[],
  from: string,
  to: string,
  alignDates: string[]
): CdiBenchmarkPayload {
  const empty: CdiBenchmarkPayload = {
    available: false,
    indexCode: 'CDI',
    observationDays: 0,
    periodReturn: null,
    series: [],
  };
  if (!rows.length || !alignDates.length) return empty;

  const indexed = buildIndexedLevelSeries(rows, from, to, 100);
  const byDate = new Map(indexed.map((p) => [p.date, p]));
  let lastLevel = 100;
  const series: BenchmarkChartPoint[] = alignDates.map((date) => {
    const pt = byDate.get(date.slice(0, 10));
    if (pt) lastLevel = pt.level;
    const level = pt?.level ?? lastLevel;
    return {
      date: date.slice(0, 10),
      indexedLevel: level,
      periodReturnToDate: Math.round((level / 100 - 1) * 1_000_000) / 1_000_000,
      dailyFactor: pt?.hadObservation ? pt.dailyFactor : null,
    };
  });

  return {
    available: true,
    indexCode: 'CDI',
    observationDays: rows.length,
    periodReturn: periodReturnFromLevelSeries(indexed),
    series,
  };
}

export type StockBenchmarkPayload = {
  available: boolean;
  ticker: string;
  observationDays: number;
  periodReturn: number | null;
  firstPrice: number | null;
  lastPrice: number | null;
  series: BenchmarkChartPoint[];
};

function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

/**
 * Buy-and-hold da ação: índice 100 no primeiro pregão com cotação no período.
 * Dias sem pregão mantêm o último fechamento (carry-forward).
 */
export function buildStockBenchmarkForChart(
  quotes: { quote_date: string; closing_price: number }[],
  alignDates: string[],
  ticker: string
): StockBenchmarkPayload {
  const empty: StockBenchmarkPayload = {
    available: false,
    ticker: ticker.toUpperCase(),
    observationDays: 0,
    periodReturn: null,
    firstPrice: null,
    lastPrice: null,
    series: [],
  };
  if (!quotes.length || !alignDates.length) return empty;

  const byDate = new Map<string, number>();
  for (const q of quotes) {
    const d = isoDate(q.quote_date);
    const px = Number(q.closing_price);
    if (d && Number.isFinite(px) && px > 0) byDate.set(d, px);
  }
  if (!byDate.size) return empty;

  const sortedDates = [...byDate.keys()].sort();
  let basePrice: number | null = null;
  for (const d of sortedDates) {
    if (d >= alignDates[0]!.slice(0, 10)) {
      basePrice = byDate.get(d)!;
      break;
    }
  }
  if (basePrice == null) basePrice = byDate.get(sortedDates[0]!)!;
  if (!basePrice || basePrice <= 0) return empty;

  let lastPrice = basePrice;
  const series: BenchmarkChartPoint[] = alignDates.map((rawDate) => {
    const date = rawDate.slice(0, 10);
    let price = byDate.get(date);
    if (price == null) {
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        if (sortedDates[i]! <= date) {
          price = byDate.get(sortedDates[i]!);
          break;
        }
      }
    }
    if (price != null && price > 0) lastPrice = price;
    const level = (lastPrice / basePrice) * 100;
    const rounded = Math.round(level * 1_000_000) / 1_000_000;
    return {
      date,
      indexedLevel: rounded,
      periodReturnToDate: Math.round((rounded / 100 - 1) * 1_000_000) / 1_000_000,
      dailyFactor: price != null && byDate.has(date) ? price / lastPrice : null,
    };
  });

  const lastPoint = series[series.length - 1];
  return {
    available: true,
    ticker: ticker.toUpperCase(),
    observationDays: byDate.size,
    periodReturn: lastPoint?.periodReturnToDate ?? null,
    firstPrice: basePrice,
    lastPrice,
    series,
  };
}

/**
 * Curva da carteira para o gráfico: TWR diário (índice 100 = 0%), com saques/aportes
 * removidos via capital_deposit/withdrawal no motor de performance.
 */
export function buildTwrPerformanceChartSeries(
  performancePoints: Array<{ date: string; cumulativeReturnTwr: number | null }>,
  baseLevel = 100
): BenchmarkChartPoint[] {
  return performancePoints.map((p) => {
    const twr = Number(p.cumulativeReturnTwr ?? 0);
    const level = Math.round(baseLevel * (1 + twr) * 1_000_000) / 1_000_000;
    return {
      date: String(p.date).slice(0, 10),
      indexedLevel: level,
      periodReturnToDate: Math.round(twr * 1_000_000) / 1_000_000,
      dailyFactor: null,
    };
  });
}

export function buildPatrimonyIndexedSeries(
  patrimonySeries: { date: string; patrimony: number }[],
  baseLevel = 100
): BenchmarkChartPoint[] {
  if (!patrimonySeries.length) return [];
  const base = Number(patrimonySeries[0]!.patrimony);
  if (!Number.isFinite(base) || base <= 0) {
    return patrimonySeries.map((p) => ({
      date: p.date.slice(0, 10),
      indexedLevel: baseLevel,
      periodReturnToDate: 0,
      dailyFactor: null,
    }));
  }
  return patrimonySeries.map((p) => {
    const level = (Number(p.patrimony) / base) * baseLevel;
    const rounded = Math.round(level * 1_000_000) / 1_000_000;
    return {
      date: p.date.slice(0, 10),
      indexedLevel: rounded,
      periodReturnToDate: Math.round((rounded / baseLevel - 1) * 1_000_000) / 1_000_000,
      dailyFactor: null,
    };
  });
}
