import {
  applyAllocationPercents,
  attachUnderlyingMarketData,
  consolidateTesouroPortfolioItems,
  enrichPortfolioRow,
  equityResultFromB3Quote,
  optionPriceReturnPct,
  isClosedOptionPosition,
  partitionPortfolioPositions,
  summarizePortfolio,
} from '../../../src/core/invest/portfolioMapper';

describe('portfolioMapper', () => {
  it('marca só o item mais específico via alocação derivada', () => {
    const row = enrichPortfolioRow({
      id: 'a1',
      asset_ticker: 'PRIO3',
      asset_type: 'stock',
      current_quantity: 100,
      managerial_avg_price: 40,
      metadata: JSON.stringify({ name: 'PetroRio', last_price: 50 }),
      status: 'active',
    });
    expect(row.marketValue).toBe(4000);
    expect(row.name).toBe('PetroRio');
  });

  it('calcula % da carteira quando ausente no metadata', () => {
    const a = enrichPortfolioRow({
      id: 'a1',
      asset_ticker: 'A',
      asset_type: 'stock',
      current_quantity: 1,
      managerial_avg_price: 100,
      metadata: { last_price: 100 },
      status: 'active',
    });
    const b = enrichPortfolioRow({
      id: 'a2',
      asset_ticker: 'B',
      asset_type: 'stock',
      current_quantity: 1,
      managerial_avg_price: 100,
      metadata: { last_price: 300 },
      status: 'active',
    });
    const items = applyAllocationPercents([a, b]);
    expect(items[0].allocationPct).toBe(50);
    expect(items[1].allocationPct).toBe(50);
    const summary = summarizePortfolio(items);
    expect(summary.totalMarketValue).toBe(200);
  });

  it('opção zerada por ticker (tipo errado no cadastro) também fecha', () => {
    const misclassified = enrichPortfolioRow({
      id: 'o3',
      asset_ticker: 'PRIOE263',
      asset_type: 'stock',
      current_quantity: 0,
      managerial_avg_price: 0,
      status: 'active',
    });
    expect(isClosedOptionPosition(misclassified)).toBe(true);
  });

  it('opção zerada vai para closedOptions e não para portfólio aberto', () => {
    const openOpt = enrichPortfolioRow({
      id: 'o1',
      asset_ticker: 'PRIOF263',
      asset_type: 'option_call',
      current_quantity: 10,
      managerial_avg_price: 1,
      status: 'active',
    });
    const closedOpt = enrichPortfolioRow({
      id: 'o2',
      asset_ticker: 'PRIOE263',
      asset_type: 'option_call',
      current_quantity: 0,
      managerial_avg_price: 0,
      status: 'active',
    });
    expect(openOpt.optionMonthName).toBe('Junho');
    expect(isClosedOptionPosition(closedOpt)).toBe(true);
    const { open, closedOptions } = partitionPortfolioPositions([openOpt, closedOpt]);
    expect(open).toHaveLength(1);
    expect(closedOptions).toHaveLength(1);
    expect(closedOptions[0]!.ticker).toBe('PRIOE263');
  });

  it('opção vencida não entra no portfólio aberto', () => {
    const expired = enrichPortfolioRow({
      id: 'o-exp',
      asset_ticker: 'PRIOD585',
      asset_type: 'option_call',
      current_quantity: 700,
      managerial_avg_price: 3.83,
      status: 'active',
    });
    expect(expired.optionExpiryDate).toMatch(/^2026-04-/);
    const { open, closedOptions } = partitionPortfolioPositions([expired], '2026-05-18');
    expect(open).toHaveLength(0);
    expect(closedOptions).toHaveLength(0);
  });

  it('calcula notional e distância ao strike mesmo com tipo stock no cadastro', () => {
    const stock = enrichPortfolioRow({
      id: 's1',
      asset_ticker: 'PRIO3',
      asset_type: 'stock',
      current_quantity: 1000,
      managerial_avg_price: 40,
      metadata: { last_price: 42.5 },
      status: 'active',
    });
    const optMis = enrichPortfolioRow({
      id: 'o-mis',
      asset_ticker: 'PRIOR407',
      asset_type: 'stock',
      current_quantity: -6500,
      managerial_avg_price: 2.2,
      metadata: { option_strike: 40.75 },
      status: 'active',
    });
    expect(optMis.optionStrike).toBe(40.75);
    const items = attachUnderlyingMarketData([stock, optMis]);
    const opt = items.find((i) => i.ticker === 'PRIOR407')!;
    expect(opt.notional).toBe(264875);
    expect(opt.underlyingLastPrice).toBe(42.5);
    expect(opt.strikeDistanceBrl).toBe(1.75);
    expect(opt.strikeDistancePct).toBeCloseTo(4.29, 1);
  });

  it('consolida aliases de Tesouro numa linha', () => {
    const lft = enrichPortfolioRow({
      id: 'lft',
      asset_ticker: 'LFT-20310301',
      asset_type: 'fixed_income',
      current_quantity: 11,
      managerial_avg_price: 18774.21,
      metadata: { last_price: 18774.21 },
      status: 'active',
    });
    const selic = enrichPortfolioRow({
      id: 'selic',
      asset_ticker: 'TESOURO-SELIC-2031',
      asset_type: 'fixed_income',
      current_quantity: 0,
      managerial_avg_price: 17236,
      metadata: { last_price: 17236 },
      status: 'active',
    });
    const merged = consolidateTesouroPortfolioItems([lft, selic]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ticker).toBe('TESOURO-SELIC-2031');
    expect(merged[0]!.quantity).toBe(11);
  });

  it('exclui renda fixa com quantidade negativa da custódia aberta', () => {
    const badLft = enrichPortfolioRow({
      id: 'lft-bad',
      asset_ticker: 'LFT-20310301',
      asset_type: 'fixed_income',
      current_quantity: -1056530,
      managerial_avg_price: 1,
      metadata: { last_price: 1 },
      status: 'active',
    });
    const tesouro = enrichPortfolioRow({
      id: 'td',
      asset_ticker: 'TESOURO-SELIC-2031',
      asset_type: 'fixed_income',
      current_quantity: 900,
      managerial_avg_price: 1100,
      metadata: { last_price: 1100 },
      status: 'active',
    });
    const { open } = partitionPortfolioPositions([badLft, tesouro]);
    expect(open.map((i) => i.ticker)).toEqual(['TESOURO-SELIC-2031']);
  });

  it('ação: resultado = (cotação − PM B3) × quantidade', () => {
    const row = enrichPortfolioRow(
      {
        id: 's-prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        current_quantity: 12700,
        managerial_avg_price: 55.7,
        metadata: { last_price: 68.82 },
        status: 'active',
      },
      { strict: 60, b3: 64.38, managerial: 55.7 }
    );
    expect(equityResultFromB3Quote(64.38, 68.82, 12700)).toBeCloseTo(56388, 0);
    expect(row.pnl).toBeCloseTo(56388, 0);
    expect(row.marketValue).toBeCloseTo(64.38 * 12700, 0);
    expect(row.updatedQuote).toBe(68.82);
  });

  it('opção: % resultado = (último − PM) / PM', () => {
    const row = enrichPortfolioRow({
      id: 'opt-pct',
      asset_ticker: 'PRIOR407',
      asset_type: 'option_put',
      current_quantity: -6500,
      managerial_avg_price: 2.2,
      metadata: { last_price: 0.01 },
      status: 'active',
    });
    expect(optionPriceReturnPct(0.01, 2.2)).toBeCloseTo(-99.55, 1);
    expect(row.pnlPct).toBeCloseTo(-99.55, 1);
    expect(row.pnl).toBeGreaterThan(0);
  });

  it('mantém ação vendida a descoberto na custódia aberta', () => {
    const shortStock = enrichPortfolioRow({
      id: 'short',
      asset_ticker: 'PRIO3',
      asset_type: 'stock',
      current_quantity: -500,
      managerial_avg_price: 40,
      metadata: { last_price: 42 },
      status: 'active',
    });
    const { open } = partitionPortfolioPositions([shortStock]);
    expect(open).toHaveLength(1);
    expect(open[0]!.quantity).toBe(-500);
  });
});
