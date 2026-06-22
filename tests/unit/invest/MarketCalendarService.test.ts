import { isB3WeekendOrHoliday } from '../../../src/core/invest/MarketCalendarService';
import { b3HolidaySet } from '../../../src/core/invest/settlementCalendar';

describe('MarketCalendarService', () => {
  it('isB3WeekendOrHoliday reconhece sabado e domingo', () => {
    expect(isB3WeekendOrHoliday('2026-01-03')).toBe(true);
    expect(isB3WeekendOrHoliday('2026-01-04')).toBe(true);
    expect(isB3WeekendOrHoliday('2026-01-05')).toBe(false);
  });

  it('isB3WeekendOrHoliday reconhece feriado B3 via algoritmo', () => {
    expect(isB3WeekendOrHoliday('2026-01-01')).toBe(true);
    expect(b3HolidaySet(2026).has('2026-04-21')).toBe(true);
    expect(isB3WeekendOrHoliday('2026-04-21')).toBe(true);
  });
});
