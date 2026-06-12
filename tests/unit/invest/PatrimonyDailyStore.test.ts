import {
  mergeStoredPatrimonySeries,
  PatrimonyDailyStore,
  trimZeroPatrimonyTailAfterLastStored,
} from '../../../src/core/invest/PatrimonyDailyStore';
import type { DailyPatrimonyPoint } from '../../../src/core/invest/PatrimonyDailyEngine';
import { InMemoryGateway } from '../core/business-events/inMemoryGateway';
import type { UserContext } from '../../../src/core/dal';

describe('mergeStoredPatrimonySeries', () => {
  const computed: DailyPatrimonyPoint[] = [
    {
      date: '2026-05-17',
      patrimonyGross: 1_500_000,
      pendingSettlements: 0,
      scheduledCashPending: 0,
      settledCash: 10_000,
      cashInTransit: 0,
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
      settledCash: 10_000,
      cashInTransit: 0,
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
            settledCash: 0,
            cashInTransit: 0,
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
            settledCash: 0,
            cashInTransit: 0,
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

describe('PatrimonyDailyStore invest_position_daily', () => {
  const ctx: UserContext = {
    userId: 'tester',
    organizationId: 'org-holding-001',
    impersonatorId: null,
    scope: 'node',
  };

  it('materializa posicoes, caixa liquidado e caixa em transito por dia', async () => {
    const gateway = new InMemoryGateway();
    const store = new PatrimonyDailyStore(gateway as any);
    const point: DailyPatrimonyPoint = {
      date: '2026-04-17',
      patrimonyGross: 1_000,
      pendingSettlements: -200,
      scheduledCashPending: -200,
      settledCash: 300,
      cashInTransit: -200,
      patrimony: 600,
      cash: 300,
      positionsValue: 500,
      dailyReturn: null,
    };

    await store.upsertPortfolioDay(ctx, {
      snapshotDate: '2026-04-17',
      point,
      patrimonyGross: 1_000,
      fixedIncomeTotal: 0,
      externalFlow: 0,
      dailyReturnTwr: null,
      cumulativeTwr: null,
      quotesAsOf: '2026-04-17',
      stockQuotes: { PRIO3: 50 },
      source: 'mtm_economic',
      positionSnapshots: [
        {
          assetId: 'asset-prio3',
          ticker: 'PRIO3',
          assetType: 'stock',
          quantity: 10,
          closingPrice: 50,
          unitCost: 40,
          marketValue: 500,
          managerialValue: 400,
          priceSource: 'market',
        },
      ],
    });

    const rows = gateway.dump('invest_position_daily')
      .filter((r) => !r.deleted_at)
      .sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));

    expect(rows.map((r) => r.ticker)).toEqual(['CAIXA-BRL', 'CAIXA-TRANSIT', 'PRIO3']);
    expect(rows.find((r) => r.ticker === 'PRIO3')).toMatchObject({
      asset_type: 'stock',
      quantity: 10,
      closing_price: 50,
      total_value: 500,
      price_source: 'market',
      account_key: 'PORTFOLIO',
    });
    expect(rows.find((r) => r.ticker === 'CAIXA-BRL')).toMatchObject({
      asset_type: 'cash',
      quantity: 300,
      total_value: 300,
      price_source: 'cash_ledger',
      account_key: 'SETTLED',
    });
    expect(rows.find((r) => r.ticker === 'CAIXA-TRANSIT')).toMatchObject({
      asset_type: 'in_transit',
      quantity: -200,
      total_value: -200,
      price_source: 'cash_ledger',
      account_key: 'IN_TRANSIT',
    });
  });

  it('bloqueia fechamento diario quando o detalhe nao explica o agregado', async () => {
    const gateway = new InMemoryGateway();
    const store = new PatrimonyDailyStore(gateway as any);
    const point: DailyPatrimonyPoint = {
      date: '2026-04-17',
      patrimonyGross: 1_000,
      pendingSettlements: 0,
      scheduledCashPending: 0,
      settledCash: 300,
      cashInTransit: 0,
      patrimony: 900,
      cash: 300,
      positionsValue: 500,
      dailyReturn: null,
    };

    await expect(
      store.upsertPortfolioDay(ctx, {
        snapshotDate: '2026-04-17',
        point,
        patrimonyGross: 1_000,
        fixedIncomeTotal: 0,
        externalFlow: 0,
        dailyReturnTwr: null,
        cumulativeTwr: null,
        quotesAsOf: '2026-04-17',
        stockQuotes: { PRIO3: 50 },
        source: 'mtm_economic',
        positionSnapshots: [
          {
            assetId: 'asset-prio3',
            ticker: 'PRIO3',
            assetType: 'stock',
            quantity: 10,
            closingPrice: 50,
            unitCost: 40,
            marketValue: 500,
            managerialValue: 400,
            priceSource: 'market',
          },
        ],
      })
    ).rejects.toThrow(/Divergencia invest_position_daily/);
  });
});
