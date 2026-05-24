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
