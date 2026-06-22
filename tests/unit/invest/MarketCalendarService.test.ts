import {
  DEFAULT_B3_EXCHANGE_CODE,
  isB3Weekend,
  MarketCalendarService,
} from '../../../src/core/invest/MarketCalendarService';

const B3_2026_HOLIDAYS = [
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-04-03',
  '2026-04-21',
  '2026-05-01',
  '2026-06-04',
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-15',
  '2026-12-25',
];

function mockGateway(holidays: string[]) {
  return {
    findWhere: jest.fn(async () =>
      holidays.map((holiday_date) => ({
        holiday_date,
        exchange_code: DEFAULT_B3_EXCHANGE_CODE,
      }))
    ),
  };
}

describe('MarketCalendarService', () => {
  const ctx = { organizationId: 'org1', userId: 'u1' } as never;

  it('isB3Weekend reconhece sabado e domingo', () => {
    expect(isB3Weekend('2026-01-03')).toBe(true);
    expect(isB3Weekend('2026-01-04')).toBe(true);
    expect(isB3Weekend('2026-01-05')).toBe(false);
  });

  it('feriado B3 vem exclusivamente do catalogo market_holidays', async () => {
    const svc = new MarketCalendarService(mockGateway(B3_2026_HOLIDAYS) as never);
    expect(await svc.isHoliday(ctx, '2026-01-01')).toBe(true);
    expect(await svc.isHoliday(ctx, '2026-04-21')).toBe(true);
    expect(await svc.isHoliday(ctx, '2026-06-17')).toBe(false);
    expect(await svc.isWeekendOrHoliday(ctx, '2026-01-01')).toBe(true);
    expect(await svc.isWeekendOrHoliday(ctx, '2026-06-17')).toBe(false);
  });

  it('sem feriados no catalogo, dia util nao e feriado (sem fallback algoritmico)', async () => {
    const svc = new MarketCalendarService(mockGateway([]) as never);
    expect(await svc.isHoliday(ctx, '2026-01-01')).toBe(false);
    expect(await svc.isWeekendOrHoliday(ctx, '2026-01-01')).toBe(false);
  });
});
