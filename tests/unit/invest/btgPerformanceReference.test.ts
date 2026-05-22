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
  it('âncoras vazias → retorna null (fonte canônica passou ao banco)', () => {
    const anchors = loadPatrimonyAnchors();
    expect(anchors.month_ends).toHaveLength(0);
    const linked = computeTwrFromMonthEndAnchors(anchors, [], '2025-12-31', '2026-05-19');
    expect(linked).toBeNull();
  });

  it('encadeia fechamentos mensais quando âncoras vêm explícitas no payload', () => {
    const anchors = {
      month_ends: [
        { date: '2025-12-31', patrimony: 1_000_000 },
        { date: '2026-01-31', patrimony: 1_050_000 },
        { date: '2026-02-28', patrimony: 1_100_000 },
      ],
    };
    const linked = computeTwrFromMonthEndAnchors(anchors, [], '2025-12-31', '2026-02-28');
    expect(linked).not.toBeNull();
    expect(linked!.months.length).toBeGreaterThan(0);
    const implied = compoundMonthlyReturns(linked!.months.map((m) => m.periodReturn));
    expect(linked!.periodReturnTwr).toBeCloseTo(implied, 4);
  });
});
