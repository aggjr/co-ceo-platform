import {
  extractBrAmountsFromGluedLine,
  normalizeBtgExtractPdfText,
  resolveBalanceAndMovement,
} from '../../../src/core/invest/btgExtractPdfText';

describe('btgExtractPdfText', () => {
  it('extractBrAmountsFromGluedLine splits concatenated PDF amounts', () => {
    expect(extractBrAmountsFromGluedLine('59.158,27399,48')).toEqual([
      59158.27, 399.48,
    ]);
    expect(extractBrAmountsFromGluedLine('6.795,7954.160,08')).toEqual([
      6795.79, 54160.08,
    ]);
  });

  it('resolveBalanceAndMovement uses previous balance', () => {
    expect(resolveBalanceAndMovement(58758.79, [59158.27, 399.48])).toEqual({
      balance: 59158.27,
      movement: 399.48,
    });
    expect(resolveBalanceAndMovement(60955.87, [6795.79, 54160.08])).toEqual({
      balance: 6795.79,
      movement: 54160.08,
    });
    expect(resolveBalanceAndMovement(455989.21, [2765.56, 453223.65])).toEqual({
      balance: 2765.56,
      movement: 453223.65,
    });
    // Taxa pequena: a+b ≈ prev mas lo << 1% do prev. balance = hi (saldo praticamente
    // intacto), movement = lo (taxa de R$ 1,72).
    expect(resolveBalanceAndMovement(6800.77, [6799.05, 1.72])).toEqual({
      balance: 6799.05,
      movement: 1.72,
    });
    // Corretagem BTC pequena: idem.
    expect(resolveBalanceAndMovement(226784.76, [226782.72, 2.04])).toEqual({
      balance: 226782.72,
      movement: 2.04,
    });
  });

  it('normalizeBtgExtractPdfText produces parser-ready lines', () => {
    const raw = [
      'Movimentação - Conta Corrente',
      ' Saldo Inicial58.758,79',
      '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026',
      '59.158,27399,48',
      '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031',
      '6.795,7954.160,08',
    ].join('\n');
    const norm = normalizeBtgExtractPdfText(raw);
    expect(norm).toContain('Saldo Inicial 58.758,79');
    expect(norm).toContain('06/01/2026 LIQ BOLSA');
    expect(norm).toContain('59.158,27');
    expect(norm).toContain('Compra de Tesouro');
  });
});
