import {
  inferOptionStrikeFromTicker,
  isOptionExpired,
} from '../../../src/core/invest/optionExpiry';

describe('inferOptionStrikeFromTicker', () => {
  it('decodifica strike típico B3', () => {
    expect(inferOptionStrikeFromTicker('PRIOR407')).toBe(40.7);
    expect(inferOptionStrikeFromTicker('BBASR120')).toBe(12);
  });
});

describe('isOptionExpired', () => {
  it('marca vencimento anterior ao dia de referência', () => {
    expect(isOptionExpired('2026-04-17', '2026-05-18')).toBe(true);
    expect(isOptionExpired('2026-05-18', '2026-05-18')).toBe(false);
    expect(isOptionExpired('2026-06-19', '2026-05-18')).toBe(false);
  });

  it('ignora datas ausentes ou inválidas', () => {
    expect(isOptionExpired(null, '2026-05-18')).toBe(false);
    expect(isOptionExpired('', '2026-05-18')).toBe(false);
  });
});
