import {
  addBusinessDays,
  cashSettlementDate,
} from '../../../src/core/invest/settlementCalendar';

describe('settlementCalendar', () => {
  it('addBusinessDays skips weekend', () => {
    expect(addBusinessDays('2026-05-15', 2)).toBe('2026-05-19');
  });

  it('stock buy settles D+2', () => {
    expect(cashSettlementDate('2026-05-12', 'stock', 'buy')).toBe('2026-05-14');
  });

  it('dividend settles same day', () => {
    expect(cashSettlementDate('2026-05-12', 'stock', 'dividend')).toBe('2026-05-12');
  });
});
