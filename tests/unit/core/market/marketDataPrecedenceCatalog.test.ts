import {
  findPrecedenceRule,
  MARKET_DATA_PRECEDENCE_CATALOG_VERSION,
  resolvePrecedenceForField,
} from '../../../../src/core/market/marketDataPrecedenceCatalog';

describe('marketDataPrecedenceCatalog (A-02)', () => {
  it('expoe versao A-02 e regra para acao B3', () => {
    expect(MARKET_DATA_PRECEDENCE_CATALOG_VERSION).toBe('A-02');
    const rule = findPrecedenceRule('stock', 'daily_close_price');
    expect(rule?.sources[0]).toBe('brapi');
    expect(rule?.minConfidence).toBe('external');
  });

  it('resolve precedencia de opcao com metadata de contrato', () => {
    expect(resolvePrecedenceForField('option_call', 'contract_strike')).toEqual([
      'opcoes_net',
      'manual',
    ]);
  });

  it('RF publica tenta tesouro antes de estimador CDI', () => {
    expect(resolvePrecedenceForField('fixed_income', 'unit_price')).toEqual([
      'tesouro_direto',
      'computed_cdi',
      'manual',
    ]);
  });
});
