import { buildDailyPatrimonyMtmSeries } from '../../../src/core/invest/PatrimonyMtmDailyEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import { emptyAssetValuationSnapshot } from '../../../src/core/invest/valuation/AssetValuationContext';

const anchors = {
  month_ends: [
    { date: '2026-01-01', patrimony: 1_000_000 },
    { date: '2026-01-31', patrimony: 1_100_000 },
    { date: '2026-12-31', patrimony: 1_200_000 },
  ],
  fixed_income_total: 100_000,
};

function stockOpen(qty: number, price: number, date = '2026-01-01'): LedgerEvent {
  return {
    asset_id: 's1',
    asset_ticker: 'PRIO3',
    asset_type: 'stock',
    transaction_type: 'opening_balance',
    transaction_date: date,
    quantity: qty,
    unit_price: price,
    total_net_value: 0,
    impacts_managerial_price: true,
  };
}

function shortPut(
  ticker: string,
  qty: number,
  premium: number,
  date: string
): LedgerEvent {
  return {
    asset_id: `o-${ticker}`,
    asset_ticker: ticker,
    asset_type: 'option_put',
    transaction_type: 'put_sell',
    transaction_date: date,
    quantity: -qty,
    unit_price: premium,
    total_net_value: qty * premium,
    impacts_managerial_price: true,
  };
}

describe('PatrimonyMtmDailyEngine', () => {
  it('alinha patrimônio às âncoras mensais BTG', () => {
    const entries: LedgerEvent[] = [
      stockOpen(1000, 50),
      {
        asset_id: 'c1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 200_000,
        unit_price: 1,
        total_net_value: 200_000,
        impacts_managerial_price: false,
      },
    ];
    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-31', {
      anchors,
      stockQuotes: { PRIO3: 50 },
      fixedIncomeTotal: 100_000,
      calibrateToAnchors: true,
    });
    const last = r.series[r.series.length - 1]!;
    expect(last.patrimony).toBeCloseTo(1_100_000, 0);
  });

  it('zera marcação de opção após vencimento', () => {
    const entries: LedgerEvent[] = [
      stockOpen(100, 40),
      shortPut('PRIOQ43', 100, 1, '2026-01-05'),
    ];
    const r = buildDailyPatrimonyMtmSeries(entries, '2026-05-10', '2026-05-20', {
      anchors,
      stockQuotes: { PRIO3: 40 },
      fixedIncomeTotal: 0,
      calibrateToAnchors: true,
    });
    expect(r.meta.method).toBe('mtm_btg_calibrated');
    expect(r.series.length).toBeGreaterThan(0);
  });

  it('classifica opcoes sem cotacao como estimadas e zeradas apos vencimento', () => {
    const entries: LedgerEvent[] = [
      shortPut('PRIOQ43', 100, 5, '2026-01-05'),
    ];

    const beforeExpiry = buildDailyPatrimonyMtmSeries(entries, '2026-01-06', '2026-01-06', {
      fixedIncomeTotal: 0,
    });
    const beforeSnapshot = beforeExpiry.positionSnapshots?.find((p) => p.ticker === 'PRIOQ43');
    expect(beforeSnapshot?.priceSource).toBe('estimated_decay');
    expect(beforeSnapshot?.closingPrice ?? 0).toBeGreaterThan(0);

    const afterExpiry = buildDailyPatrimonyMtmSeries(entries, '2026-05-20', '2026-05-20', {
      fixedIncomeTotal: 0,
    });
    const afterSnapshot = afterExpiry.positionSnapshots?.find((p) => p.ticker === 'PRIOQ43');
    expect(afterSnapshot?.priceSource).toBe('expired_zero');
    expect(afterSnapshot?.closingPrice).toBe(0);
    expect(afterSnapshot?.marketValue).toBe(0);
  });

  it('nao usa cotação atual quando quoteForDate está definido', () => {
    const entries: LedgerEvent[] = [stockOpen(100, 10, '2026-01-01')];
    const quoteForDate = (_ticker: string, date: string) =>
      date === '2026-01-02' ? 20 : 10;

    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-02', {
      stockQuotes: { PRIO3: 999 },
      quoteForDate,
      fixedIncomeTotal: 0,
    });
    const day2 = r.series.find((p) => p.date === '2026-01-02');
    expect(day2?.patrimony).toBeCloseTo(2000, 0);
  });

  it('desconta compra D+2 do caixa em trânsito no dia do negócio', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 'c1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-02',
        quantity: 5000,
        unit_price: 1,
        total_net_value: 5000,
        impacts_managerial_price: false,
      },
      {
        asset_id: 's1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-02',
        quantity: 100,
        unit_price: 40,
        total_net_value: 4000,
        impacts_managerial_price: true,
      },
    ];
    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-02', '2026-01-02', {
      stockQuotes: { PRIO3: 40 },
      fixedIncomeTotal: 0,
    });
    const day = r.series[0]!;
    expect(day.patrimony).toBeCloseTo(5000, 0);
    expect(day.scheduledCashPending).toBeCloseTo(-4000, 0);
  });

  it('marca renda fixa pelo preço diário quando houver cotação', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 'rf1',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 10,
        unit_price: 1000,
        total_net_value: 10_000,
        impacts_managerial_price: true,
      },
    ];

    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-02', {
      fixedIncomeTotal: 0,
      quoteForDate: (_ticker, date) => (date === '2026-01-02' ? 1100 : 1000),
    });

    const day2 = r.series.find((p) => p.date === '2026-01-02');
    const snapshot = r.positionSnapshots?.find((p) => p.ticker === 'LFT-20310301');

    expect(day2?.patrimony).toBeCloseTo(11_000, 0);
    expect(snapshot?.closingPrice).toBeCloseTo(1100, 0);
    expect(snapshot?.marketValue).toBeCloseTo(11_000, 0);
  });

  it('valoriza qualquer subcategoria market_price configurada no catalogo com conversao FX', () => {
    const valuation = emptyAssetValuationSnapshot();
    valuation.categories.set('stock_us', {
      moduleCode: 'INVEST',
      category: 'financial_asset',
      subcategory: 'stock_us',
      contributesToPatrimony: true,
      requiresMarketQuote: true,
      quoteSource: 'yahoo_finance',
      valuationMode: 'market_price',
      exchangeCode: 'NASDAQ_US',
      currencyCode: 'USD',
      settlementCounterpartyCode: 'NASDAQ_US',
      settlementContractTypeCode: 'US_EQUITY_SPOT',
      affectsPortfolio: true,
      affectsFinancial: true,
    });
    valuation.contributesToPatrimony.add('stock_us');
    valuation.requiresMarketQuote.add('stock_us');
    valuation.currencyByType.set('stock_us', 'USD');

    const entries: LedgerEvent[] = [
      {
        asset_id: 'us1',
        asset_ticker: 'AAPL',
        asset_type: 'stock_us',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 10,
        unit_price: 100,
        total_net_value: 1000,
        impacts_managerial_price: true,
      },
    ];

    const r = buildDailyPatrimonyMtmSeries(entries, '2026-01-01', '2026-01-01', {
      fixedIncomeTotal: 0,
      valuationContext: valuation,
      quoteForDate: () => 100,
      fxRateForDate: (from, to) => from === 'USD' && to === 'BRL' ? 5 : undefined,
    });

    expect(r.series[0]?.patrimony).toBeCloseTo(5000, 0);
    expect(r.positionSnapshots?.[0]?.marketValue).toBeCloseTo(5000, 0);
  });

  it('mantem acoes B3 no patrimonio mesmo com catalogo legado incompleto', () => {
    const valuation = emptyAssetValuationSnapshot();
    valuation.categories.set('stock', {
      moduleCode: 'INVEST',
      category: 'financial_asset',
      subcategory: 'stock',
      contributesToPatrimony: false,
      requiresMarketQuote: false,
      quoteSource: null,
      valuationMode: 'historical_cost',
      exchangeCode: null,
      currencyCode: 'BRL',
      settlementCounterpartyCode: null,
      settlementContractTypeCode: null,
      affectsPortfolio: true,
      affectsFinancial: true,
    });

    const r = buildDailyPatrimonyMtmSeries(
      [stockOpen(100, 40, '2026-04-17')],
      '2026-04-17',
      '2026-04-17',
      {
        fixedIncomeTotal: 0,
        valuationContext: valuation,
        quoteForDate: () => 41,
      }
    );

    expect(r.series[0]?.positionsValue).toBeCloseTo(4100, 0);
    expect(r.series[0]?.patrimony).toBeCloseTo(4100, 0);
  });

  it('carrega posicoes anteriores ao inicio do filtro', () => {
    const entries: LedgerEvent[] = [stockOpen(100, 40, '2026-01-01')];

    const r = buildDailyPatrimonyMtmSeries(entries, '2026-04-17', '2026-04-17', {
      fixedIncomeTotal: 0,
      quoteForDate: () => 42,
    });

    expect(r.series[0]?.positionsValue).toBeCloseTo(4200, 0);
    expect(r.series[0]?.patrimony).toBeCloseTo(4200, 0);
  });
});
