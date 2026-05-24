import { HOLDING_BTG_PATRIMONY_ANCHORS } from '../../../src/core/invest/btgPatrimonyAnchorReference';
import { interpolatePatrimonyTarget } from '../../../src/core/invest/patrimonyAnchors';
import { filterStoredDaysForChartMethod } from '../../../src/core/invest/PatrimonyDailyStore';
import type { StoredPortfolioDay } from '../../../src/core/invest/PatrimonyDailyStore';

describe('patrimonyAnchors (BTG holding)', () => {
  it('interpola perto de 1,22M em 01/01/2026 a partir do fechamento 31/12/2025', () => {
    const p = interpolatePatrimonyTarget('2026-01-01', HOLDING_BTG_PATRIMONY_ANCHORS);
    expect(p).toBeGreaterThan(1_220_000);
    expect(p).toBeLessThan(1_230_000);
  });

  it('atinge âncora de 31/01/2026', () => {
    const p = interpolatePatrimonyTarget('2026-01-31', HOLDING_BTG_PATRIMONY_ANCHORS);
    expect(p).toBeCloseTo(1_324_490, 0);
  });
});

describe('filterStoredDaysForChartMethod', () => {
  const stored: StoredPortfolioDay[] = [
    {
      id: '1',
      organization_id: 'org',
      snapshot_date: '2026-01-15',
      patrimony: 500_000,
      patrimony_gross: 500_000,
      cash: 0,
      positions_value: 500_000,
      pending_settlements: 0,
      fixed_income_total: 0,
      external_flow: 0,
      daily_return_simple: null,
      daily_return_twr: null,
      cumulative_twr: null,
      quotes_as_of: null,
      source: 'mtm_economic',
      metadata: null,
    },
  ];

  it('não mescla mtm_economic na curva mtm_btg', () => {
    expect(filterStoredDaysForChartMethod(stored, 'mtm_btg')).toHaveLength(0);
  });

  it('mantém mtm_economic no modo econômico', () => {
    expect(filterStoredDaysForChartMethod(stored, 'mtm_economic')).toHaveLength(1);
  });
});
