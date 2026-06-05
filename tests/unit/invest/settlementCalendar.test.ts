import {
  addCalendarDays,
  addBusinessDays,
  cashSettlementDate,
  investmentSettlementRuleFor,
  SETTLEMENT_CONTRACT_TYPES,
  SETTLEMENT_COUNTERPARTIES,
  SETTLEMENT_COUNTERPARTY_CONTRACT_TYPES,
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

  it('models settlement as counterparty-to-contract-type N:N', () => {
    expect(SETTLEMENT_COUNTERPARTIES.some((c) => c.counterpartyCode === 'B3_BR')).toBe(true);
    expect(SETTLEMENT_CONTRACT_TYPES.some((c) => c.contractTypeCode === 'B3_EQUITY_SPOT')).toBe(true);
    expect(
      SETTLEMENT_COUNTERPARTY_CONTRACT_TYPES.some(
        (row) => row.counterpartyCode === 'B3_BR' && row.contractTypeCode === 'B3_EQUITY_SPOT'
      )
    ).toBe(true);
    expect(
      SETTLEMENT_COUNTERPARTY_CONTRACT_TYPES.some(
        (row) => row.counterpartyCode === 'TESOURO_BR' && row.contractTypeCode === 'BR_FIXED_INCOME_SPOT'
      )
    ).toBe(true);
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
    expect(rule?.contractTypeCode).toBe('SECURITIES_LENDING');
    expect(cashSettlementDate('2026-05-15', 'securities_lending', 'securities_lending', 'PRIO3')).toBe(
      '2026-06-14'
    );
  });
});
