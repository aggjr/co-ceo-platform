import {
  attachCallCoverageToEquities,
  buildShortCallPremiumPendingByUnderlying,
  buildShortCallsSoldByUnderlying,
  collectCallCoverageOptionRows,
  equityCallCoverageCapacity,
  formatOptionTypeLabel,
  optionQtyAbs,
  resolveOptionSide,
  sumShortCallQtyAbs,
} from '../../../src/core/invest/callCoverage';

describe('call coverage (ações × CALL vendida)', () => {
  it('quantidade absoluta preserva a unidade do livro razão (sem lotes)', () => {
    expect(optionQtyAbs(4)).toBe(4);
    expect(optionQtyAbs(-6500)).toBe(6500);
    expect(optionQtyAbs(500)).toBe(500);
    expect(optionQtyAbs(-900)).toBe(900);
  });

  it('classifica tipo B3: A–L CALL, M–X PUT', () => {
    expect(resolveOptionSide({ ticker: 'PRIOF760' })).toBe('call');
    expect(resolveOptionSide({ ticker: 'PRIOR407' })).toBe('put');
    expect(formatOptionTypeLabel('call')).toBe('CALL');
    expect(formatOptionTypeLabel('put')).toBe('PUT');
  });

  it('soma CALLs vendidas por underlying (ignora PUT)', () => {
    const options = [
      {
        ticker: 'PRIOR407',
        underlying: 'PRIO3',
        quantity: -6500,
        optionSide: 'put',
        assetType: 'option_put',
      },
      {
        ticker: 'PRIOF760',
        underlying: 'PRIO3',
        quantity: -900,
        optionSide: 'call',
        assetType: 'option_call',
      },
      {
        ticker: 'PRIOF780',
        underlying: 'PRIO3',
        quantity: -500,
        optionSide: 'call',
        assetType: 'option_call',
      },
    ];
    const map = buildShortCallsSoldByUnderlying(options);
    expect(map.get('PRIO3')).toBe(1400);
    expect(sumShortCallQtyAbs(options)).toBe(1400);
  });

  it('cobertura: cada ação cobre uma CALL vendida na mesma unidade', () => {
    const equities = [
      {
        ticker: 'PRIO3',
        assetType: 'stock',
        quantity: 12700,
      },
    ];
    const options = [
      {
        ticker: 'PRIOF760',
        underlying: 'PRIO3',
        quantity: -900,
        optionSide: 'call',
        assetType: 'option_call',
      },
    ];
    const rows = attachCallCoverageToEquities(equities, options);
    const row = rows[0] as (typeof equities)[0] & {
      callsSold: number;
      callsRemaining: number;
    };
    expect(equityCallCoverageCapacity(12700)).toBe(12700);
    expect(row.callsSold).toBe(900);
    expect(row.callsRemaining).toBe(11800);
  });

  it('PRIOF do livro-razão alimenta CALLs vendidas e prêmio D+1 em PRIO3', () => {
    const ledgerEvents = [
      {
        asset_id: 'pf1',
        asset_ticker: 'PRIOF760',
        asset_type: 'option_call',
        underlying_ticker: 'PRIO3',
        transaction_type: 'call_sell',
        quantity: -900,
        unit_price: 1.24,
        total_net_value: 1116,
      },
      {
        asset_id: 'pf2',
        asset_ticker: 'PRIOF780',
        asset_type: 'option_call',
        underlying_ticker: 'PRIO3',
        transaction_type: 'call_sell',
        quantity: -500,
        unit_price: 0.88,
        total_net_value: 440,
      },
    ];
    const coverage = collectCallCoverageOptionRows([], [
      {
        assetId: '1',
        ticker: 'PRIOF760',
        assetType: 'option_call',
        underlying: 'PRIO3',
        quantity: -900,
        avgPrice: 1.24,
      },
      {
        assetId: '2',
        ticker: 'PRIOF780',
        assetType: 'option_call',
        underlying: 'PRIO3',
        quantity: -500,
        avgPrice: 0.88,
      },
    ]);
    expect(sumShortCallQtyAbs(coverage)).toBe(1400);
    const prem = buildShortCallPremiumPendingByUnderlying(ledgerEvents);
    expect(prem.get('PRIO3')).toBe(1556);
  });
});
