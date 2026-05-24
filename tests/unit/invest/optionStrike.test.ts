import { resolveOptionStrike } from '../../../src/core/invest/optionStrike';

describe('resolveOptionStrike', () => {
  it('prioriza catálogo de mercado sobre metadata da operação', () => {
    const r = resolveOptionStrike({
      meta: { option_strike: 40.7 },
      ticker: 'PRIOR407',
      marketStrike: 40.75,
      ledgerExerciseStrike: 41,
    });
    expect(r.strike).toBe(40.75);
    expect(r.source).toBe('market_catalog');
  });

  it('usa metadata quando não há mercado nem exercício', () => {
    const r = resolveOptionStrike({
      meta: { option_strike: 40.7 },
      ticker: 'PRIOR407',
    });
    expect(r.strike).toBe(40.7);
    expect(r.source).toBe('metadata');
  });
});
