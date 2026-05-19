import {
  btgPublishedTwr,
  compareToBtgPublished,
  compoundMonthlyReturns,
} from '../../../src/core/invest/btgPerformanceReference';
import { computeTwrFromMonthEndAnchors } from '../../../src/core/invest/portfolioPerformance';
import { loadPatrimonyAnchors } from '../../../src/core/invest/patrimonyAnchors';

describe('btgPerformanceReference', () => {
  it('compõe retornos mensais BTG Jan–Mai ≈ 27,86%', () => {
    const twr = btgPublishedTwr('2026-01', '2026-05');
    expect(twr).not.toBeNull();
    expect(twr!).toBeCloseTo(0.2786, 2);
  });

  it('compara sistema vs BTG', () => {
    const c = compareToBtgPublished(0.2448, '2026-01', '2026-05');
    expect(c?.btgPublishedTwr).toBeCloseTo(0.2786, 2);
    expect(c?.gapPctPoints).toBeCloseTo(-3.38, 1);
  });
});

describe('computeTwrFromMonthEndAnchors', () => {
  it('encadeia fechamentos mensais das âncoras', () => {
    const anchors = loadPatrimonyAnchors();
    const linked = computeTwrFromMonthEndAnchors(anchors, [], '2025-12-31', '2026-05-19');
    expect(linked).not.toBeNull();
    expect(linked!.months.length).toBeGreaterThan(0);
    const implied = compoundMonthlyReturns(linked!.months.map((m) => m.periodReturn));
    expect(linked!.periodReturnTwr).toBeCloseTo(implied, 4);
  });
});
