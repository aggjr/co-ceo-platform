import {
  btgLinesToImportEntries,
  classifyBtgDescription,
  parseBtgMovementLine,
  parseBrNumber,
} from '../../../src/core/invest/BtgExtractLineParser';

describe('BtgExtractLineParser', () => {
  it('parseBrNumber', () => {
    expect(parseBrNumber('58.758,79')).toBeCloseTo(58758.79);
    expect(parseBrNumber('-128.599,23')).toBeCloseTo(-128599.23);
  });

  it('parseBtgMovementLine with balance delta', () => {
    const row = parseBtgMovementLine(
      '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27 399,48',
      58758.79
    );
    expect(row?.date).toBe('2026-01-06');
    expect(row?.signedCash).toBeCloseTo(399.48);
  });

  it('skips aggregated bolsa liquidation', () => {
    expect(
      classifyBtgDescription('LIQ BOLSA (Operacoes)- Pregão:05/01/2026').skip
    ).toBe(true);
  });

  it('maps tesouro compra', () => {
    const map = classifyBtgDescription('Compra de Tesouro Direto: LFT 01/03/2031');
    expect(map.operation).toBe('buy');
    expect(map.ticker).toBe('LFT-20310301');
  });

  it('btgLinesToImportEntries ignores LIQ BOLSA operacoes', () => {
    const entries = btgLinesToImportEntries(
      [
        'Saldo Inicial 58.758,79',
        '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27\t399,48',
        '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031 54.160,08\t6.795,79',
      ],
      58758.79
    );
    expect(entries.some((e) => e.operation === 'buy' && e.ticker === 'LFT-20310301')).toBe(
      true
    );
    expect(entries.some((e) => e.notes?.includes('LIQ BOLSA (Operacoes)'))).toBe(false);
  });
});
