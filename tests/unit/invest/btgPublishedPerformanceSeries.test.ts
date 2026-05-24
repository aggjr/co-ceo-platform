import {
  btgPublishedFactorAtDate,
  btgPublishedTwrBetween,
  buildBtgPublishedDailyPerformancePoints,
} from '../../../src/core/invest/btgPublishedPerformanceSeries';
import { btgPublishedTwr } from '../../../src/core/invest/btgPerformanceReference';

describe('btgPublishedPerformanceSeries', () => {
  it('compõe Jan–Mai completo ≈ 27,86% (tabela homebroker)', () => {
    const twr = btgPublishedTwr('2026-01', '2026-05');
    expect(twr).toBeCloseTo(0.2786, 2);
    expect(btgPublishedTwrBetween('2026-01-01', '2026-05-31')).toBeCloseTo(0.2786, 2);
  });

  it('rateia maio parcial até 22/05 abaixo do mês cheio', () => {
    const fullMay = btgPublishedTwrBetween('2026-05-01', '2026-05-31');
    const partialMay = btgPublishedTwrBetween('2026-05-01', '2026-05-22');
    expect(fullMay).not.toBeNull();
    expect(partialMay).not.toBeNull();
    expect(partialMay!).toBeLessThan(fullMay!);
  });

  it('período 31/12/2025 → 22/05/2026 fica acima de 18% e perto do BTG', () => {
    const twr = btgPublishedTwrBetween('2025-12-31', '2026-05-22');
    expect(twr).not.toBeNull();
    expect(twr!).toBeGreaterThan(0.24);
    expect(twr!).toBeLessThanOrEqual(btgPublishedTwr('2026-01', '2026-05')! + 0.01);
  });

  it('gera curva diária crescente no índice', () => {
    const points = buildBtgPublishedDailyPerformancePoints(
      ['2026-01-01', '2026-01-15', '2026-01-31'],
      '2026-01-01'
    );
    expect(points[0]!.cumulativeReturnTwr).toBe(0);
    expect(points[points.length - 1]!.cumulativeReturnTwr).toBeCloseTo(0.085, 2);
    expect(btgPublishedFactorAtDate('2026-01-01', '2026-01-31')).toBeCloseTo(1.085, 3);
  });
});
