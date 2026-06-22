import {
  allocateLftLotForBuy,
  brShortDateToIso,
  cloneLftInvestmentLots,
  parseBrNumberFlexible,
  parseLftInvestmentLotsInline,
  parseLftInvestmentLotsFromLines,
} from '../../../src/core/invest/lftInvestmentStatementLots';

const INLINE_SNIPPET =
  'LFT   08/01/25   01/03/31   21/01/26   Não   -   -   SELIC +  0,09%   6,0   18.145,3400   108.872,04   19.126,260000   114.757,56 ' +
  'LFT   08/01/25   01/03/31   27/01/26   Não   -   -   SELIC +  0,09%   2,89   18.185,8400   52.557,07   19.126,260000   55.274,89';

describe('lftInvestmentStatementLots', () => {
  it('parseBrNumberFlexible aceita 2 e 4 casas decimais', () => {
    expect(parseBrNumberFlexible('18.145,3400')).toBe(18145.34);
    expect(parseBrNumberFlexible('108.872,04')).toBe(108872.04);
    expect(parseBrNumberFlexible('6,0')).toBe(6);
  });

  it('brShortDateToIso converte dd/mm/yy', () => {
    expect(brShortDateToIso('21/01/26')).toBe('2026-01-21');
  });

  it('parseLftInvestmentLotsInline extrai lotes do PDF de investimento', () => {
    const lots = parseLftInvestmentLotsInline(INLINE_SNIPPET);
    expect(lots.length).toBe(2);
    expect(lots[0]).toMatchObject({
      acquisitionDate: '2026-01-21',
      quantity: 6,
      buyPrice: 18145.34,
      buyValue: 108872.04,
      ticker: 'LFT-20310301',
    });
    expect(lots[1]).toMatchObject({
      acquisitionDate: '2026-01-27',
      quantity: 2.89,
      buyValue: 52557.07,
    });
  });

  it('parseLftInvestmentLotsFromLines extrai formato linha separada', () => {
    const lots = parseLftInvestmentLotsFromLines([
      'LFT 08/01/25 01/03/31 21/01/26',
      '6,0 18.145,3400 108.872,04 19.126,2600 114.757,56 1.324,24 0 113.433,32',
    ]);
    expect(lots.length).toBe(1);
    expect(lots[0]?.quantity).toBe(6);
    expect(lots[0]?.buyValue).toBe(108872.04);
  });

  it('allocateLftLotForBuy casa liquidação T+1 quando valor CC bate com lote', () => {
    const lots = cloneLftInvestmentLots(parseLftInvestmentLotsInline(INLINE_SNIPPET));
    expect(allocateLftLotForBuy(lots, '2026-01-22', 'LFT-20310301', 181_453.4)).toBeUndefined();
    expect(lots[0]?.used).toBe(false);

    const hit = allocateLftLotForBuy(lots, '2026-01-22', 'LFT-20310301', 108_872.04);
    expect(hit?.quantity).toBe(6);
    expect(hit?.buyValue).toBe(108872.04);
    expect(lots[0]?.used).toBe(true);

    const second = allocateLftLotForBuy(lots, '2026-01-28', 'LFT-20310301', 52_557.07);
    expect(second?.quantity).toBe(2.89);
    expect(second?.buyValue).toBe(52557.07);
  });
});
