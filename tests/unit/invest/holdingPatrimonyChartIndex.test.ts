function toIndexedFromFirst(values: number[], baseLevel = 100): number[] {
  const first = Number(values[0]);
  if (!Number.isFinite(first) || first <= 0) {
    return values.map(() => baseLevel);
  }
  return values.map((v) =>
    Math.round((Number(v) / first) * baseLevel * 1_000_000) / 1_000_000
  );
}

function rebaseIndexedSeries(values: Array<number | null>): Array<number | null> {
  const firstIdx = values.findIndex((v) => v != null && Number.isFinite(Number(v)));
  if (firstIdx < 0) return values;
  const base = Number(values[firstIdx]);
  if (!base || base <= 0) return values;
  return values.map((v) =>
    v == null || !Number.isFinite(Number(v))
      ? null
      : Math.round((Number(v) / base) * 100 * 1_000_000) / 1_000_000
  );
}

function indexSeriesHasVariation(values: Array<number | null>): boolean {
  const nums = values
    .filter((v): v is number => v != null && Number.isFinite(v))
    .map((v) => Number(v));
  if (nums.length < 2) return false;
  return Math.max(...nums) - Math.min(...nums) > 0.05;
}

/** Espelha buildPortfolioIndexValues (frontend) para teste sem import ESM. */
function buildPortfolioIndexValuesLike(
  labels: string[],
  patrimonyBrl: number[],
  portfolioChartSeries: Array<{ date: string; indexedLevel: number }>,
  performance: { points: Array<{ date: string; cumulativeReturnTwr: number }> } | null
): Array<number | null> {
  const iso = (d: string) => d.slice(0, 10);
  const fromApiMap = new Map(
    portfolioChartSeries.map((p) => [iso(p.date), Number(p.indexedLevel)])
  );
  if (fromApiMap.size) {
    const aligned = labels.map((d) => {
      const v = fromApiMap.get(iso(d));
      return v != null && Number.isFinite(v) ? v : null;
    });
    const rebased = rebaseIndexedSeries(aligned);
    if (indexSeriesHasVariation(rebased)) return rebased;
  }
  const points = performance?.points;
  if (points?.length) {
    const perfMap = new Map(points.map((p) => [iso(p.date), Number(p.cumulativeReturnTwr ?? 0)]));
    const fromPerf = rebaseIndexedSeries(
      labels.map((d) => {
        const key = iso(d);
        if (!perfMap.has(key)) return null;
        const twr = perfMap.get(key) ?? 0;
        return Math.round(100 * (1 + twr) * 1_000_000) / 1_000_000;
      })
    );
    if (indexSeriesHasVariation(fromPerf)) return fromPerf;
  }
  return rebaseIndexedSeries(toIndexedFromFirst(patrimonyBrl));
}

describe('buildPortfolioIndexValues (espelho frontend)', () => {
  it('usa performance.points quando portfolioIndexed da API está plano', () => {
    const labels = ['2026-01-01', '2026-01-02'];
    const patrimony = [1_000_000, 1_050_000];
    const flatApi = [
      { date: '2026-01-01', indexedLevel: 100 },
      { date: '2026-01-02', indexedLevel: 100 },
    ];
    const performance = {
      points: [
        { date: '2026-01-01', cumulativeReturnTwr: 0 },
        { date: '2026-01-02', cumulativeReturnTwr: 0.05 },
      ],
    };
    const values = buildPortfolioIndexValuesLike(labels, patrimony, flatApi, performance);
    expect(values[0]).toBe(100);
    expect(values[1]).toBeCloseTo(105, 1);
  });
});

describe('holdingPatrimonyChart index', () => {
  it('carteira começa em 100 (0%)', () => {
    const idx = toIndexedFromFirst([1_224_319, 1_324_490]);
    expect(idx[0]).toBe(100);
    expect(idx[1]).toBeCloseTo(108.5, 0);
  });

  it('rebase alinha série ao primeiro dia visível', () => {
    const rebased = rebaseIndexedSeries([null, 105, 110]);
    expect(rebased[1]).toBe(100);
    expect(rebased[2]).toBeCloseTo(104.76, 1);
  });
});
