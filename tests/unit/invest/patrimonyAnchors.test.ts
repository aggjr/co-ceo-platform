import {
  PATRIMONY_SOURCE_STORED_LEGACY,
} from '../../../src/core/invest/patrimonyChartMethods';
import { SAMPLE_PATRIMONY_ANCHORS } from '../../fixtures/patrimonyAnchorsSample';
import { interpolatePatrimonyTarget } from '../../../src/core/invest/patrimonyAnchors';
import { filterStoredDaysForChartMethod } from '../../../src/core/invest/PatrimonyDailyStore';
import type { StoredPortfolioDay } from '../../../src/core/invest/PatrimonyDailyStore';

describe('patrimonyAnchors (BTG holding)', () => {
  it('interpola perto de 1,22M em 01/01/2026 a partir do fechamento 31/12/2025', () => {
    const p = interpolatePatrimonyTarget('2026-01-01', SAMPLE_PATRIMONY_ANCHORS);
    expect(p).toBeCloseTo(1_212_435.41, 2);
  });

  it('atinge ancora de 31/01/2026', () => {
    const p = interpolatePatrimonyTarget('2026-01-31', SAMPLE_PATRIMONY_ANCHORS);
    expect(p).toBeCloseTo(1_320_481.6, 2);
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
    {
      id: '2',
      organization_id: 'org',
      snapshot_date: '2026-01-31',
      patrimony: 550_000,
      patrimony_gross: 550_000,
      cash: 0,
      positions_value: 550_000,
      pending_settlements: 0,
      fixed_income_total: 0,
      external_flow: 0,
      daily_return_simple: null,
      daily_return_twr: null,
      cumulative_twr: null,
      quotes_as_of: null,
      source: PATRIMONY_SOURCE_STORED_LEGACY,
      metadata: null,
    },
  ];

  it('mescla fechamento legado BTG na curva mtm_btg', () => {
    const filtered = filterStoredDaysForChartMethod(stored, 'mtm_btg');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.source).toBe(PATRIMONY_SOURCE_STORED_LEGACY);
  });

  it('mantem fechamentos gravados autoritativos no modo economico', () => {
    expect(filterStoredDaysForChartMethod(stored, 'mtm_economic')).toHaveLength(2);
  });
});
