import {
  mergeStoredPatrimonySeries,
  trimZeroPatrimonyTailAfterLastStored,
} from '../../../src/core/invest/PatrimonyDailyStore';
import type { DailyPatrimonyPoint } from '../../../src/core/invest/PatrimonyDailyEngine';

describe('mergeStoredPatrimonySeries', () => {
  const computed: DailyPatrimonyPoint[] = [
    {
      date: '2026-05-17',
      patrimonyGross: 1_500_000,
      pendingSettlements: 0,
      scheduledCashPending: 0,
      patrimony: 1_500_000,
      cash: 10_000,
      positionsValue: 1_490_000,
      dailyReturn: null,
    },
    {
      date: '2026-05-18',
      patrimonyGross: 1_510_000,
      pendingSettlements: 0,
      scheduledCashPending: 0,
      patrimony: 1_510_000,
      cash: 10_000,
      positionsValue: 1_500_000,
      dailyReturn: 0.0067,
    },
  ];

  it('substitui dias gravados na série calculada', () => {
    const { series, storedDates } = mergeStoredPatrimonySeries(computed, [
      {
        id: '1',
        organization_id: 'org',
        snapshot_date: '2026-05-18',
        patrimony: 1_509_811.26,
        patrimony_gross: 1_509_811.26,
        cash: 2_765.56,
        positions_value: 1_507_045.7,
        pending_settlements: 0,
        fixed_income_total: 0,
        external_flow: 0,
        daily_return_simple: 0.003,
        daily_return_twr: 0.003,
        cumulative_twr: 0.05,
        quotes_as_of: '2026-05-18',
        source: 'mtm_economic',
        metadata: null,
      },
    ]);
    expect(storedDates).toEqual(['2026-05-18']);
    expect(series[1]!.patrimony).toBeCloseTo(1_509_811.26, 2);
    expect(series[1]!.cash).toBeCloseTo(2_765.56, 2);
    expect(series[0]!.patrimony).toBe(1_500_000);
  });
});

describe('trimZeroPatrimonyTailAfterLastStored', () => {
  it('remove dia calculado com patrimônio zero após último fechamento gravado', () => {
    const stored = [
      {
        id: '1',
        organization_id: 'org',
        snapshot_date: '2026-05-21',
        patrimony: 1_509_811.26,
        patrimony_gross: 1_509_811.26,
        cash: 0,
        positions_value: 1_509_811.26,
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
    const series = [
      ...mergeStoredPatrimonySeries(
        [
          {
            date: '2026-05-21',
            patrimonyGross: 0,
            pendingSettlements: 0,
            scheduledCashPending: 0,
            patrimony: 0,
            cash: 0,
            positionsValue: 0,
            dailyReturn: null,
          },
          {
            date: '2026-05-22',
            patrimonyGross: 0,
            pendingSettlements: 0,
            scheduledCashPending: 0,
            patrimony: 0,
            cash: 0,
            positionsValue: 0,
            dailyReturn: null,
          },
        ],
        stored
      ).series,
    ];
    const trimmed = trimZeroPatrimonyTailAfterLastStored(series, stored);
    expect(trimmed.map((p) => p.date)).toEqual(['2026-05-21']);
    expect(trimmed[0]!.patrimony).toBeCloseTo(1_509_811.26, 2);
  });
});
