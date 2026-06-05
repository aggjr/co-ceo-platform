import {
  addCalendarDays,
  addBusinessDays,
  cashSettlementDate,
  investmentSettlementRuleFor,
} from '../../../src/core/invest/settlementCalendar';

describe('settlementCalendar', () => {
  it('addBusinessDays skips weekend', () => {
    expect(addBusinessDays('2026-05-15', 2)).toBe('2026-05-19');
  });

  it('addCalendarDays keeps calendar-day products configurable', () => {
    expect(addCalendarDays('2026-05-15', 30)).toBe('2026-06-14');
  });

  it('stock buy settles D+2', () => {
    expect(cashSettlementDate('2026-05-12', 'stock', 'buy')).toBe('2026-05-14');
  });

  it('legacy stock trades before B3 D+2 migration settle D+3', () => {
    expect(cashSettlementDate('2018-05-14', 'stock', 'buy')).toBe('2018-05-17');
  });

  it('dividend settles same day', () => {
    expect(cashSettlementDate('2026-05-12', 'stock', 'dividend')).toBe('2026-05-12');
  });

  it('put_sell premium settles D+1', () => {
    expect(cashSettlementDate('2026-05-15', 'option_put', 'put_sell', 'ITUBQ445')).toBe(
      '2026-05-18'
    );
  });

  it('securities lending uses a 30 calendar-day settlement rule', () => {
    const rule = investmentSettlementRuleFor(
      '2026-05-15',
      'securities_lending',
      'securities_lending',
      'PRIO3'
    );
    expect(rule?.ruleCode).toBe('SECURITIES_LENDING_NET30');
    expect(cashSettlementDate('2026-05-15', 'securities_lending', 'securities_lending', 'PRIO3')).toBe(
      '2026-06-14'
    );
  });
});
