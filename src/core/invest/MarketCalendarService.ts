import type { CoCeoDataGateway, UserContext } from '../dal';
import { isB3BusinessHoliday } from './settlementCalendar';

export const DEFAULT_B3_EXCHANGE_CODE = 'B3_BR';

function isWeekendUtc(isoDate: string): boolean {
  const dow = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Fallback sincrono (sem DB) — mesmo algoritmo de settlementCalendar. */
export function isB3WeekendOrHoliday(isoDate: string): boolean {
  const day = isoDate.slice(0, 10);
  return isWeekendUtc(day) || isB3BusinessHoliday(day);
}

/**
 * Calendario de mercado canonico: feriados em market_holidays (catalogo global),
 * com fallback para o algoritmo B3 em settlementCalendar.ts.
 */
export class MarketCalendarService {
  private readonly holidayCache = new Map<string, Set<string>>();

  constructor(private readonly gateway: CoCeoDataGateway) {}

  async isHoliday(
    ctx: UserContext,
    isoDate: string,
    exchangeCode = DEFAULT_B3_EXCHANGE_CODE
  ): Promise<boolean> {
    const day = isoDate.slice(0, 10);
    const cacheKey = `${exchangeCode}:${day.slice(0, 4)}`;
    let yearSet = this.holidayCache.get(cacheKey);
    if (!yearSet) {
      yearSet = await this.loadHolidaySetForYear(ctx, exchangeCode, day.slice(0, 4));
      this.holidayCache.set(cacheKey, yearSet);
    }
    if (yearSet.has(day)) return true;
    if (exchangeCode === DEFAULT_B3_EXCHANGE_CODE) {
      return isB3BusinessHoliday(day);
    }
    return false;
  }

  async isWeekendOrHoliday(
    ctx: UserContext,
    isoDate: string,
    exchangeCode = DEFAULT_B3_EXCHANGE_CODE
  ): Promise<boolean> {
    const day = isoDate.slice(0, 10);
    if (isWeekendUtc(day)) return true;
    return this.isHoliday(ctx, day, exchangeCode);
  }

  private async loadHolidaySetForYear(
    ctx: UserContext,
    exchangeCode: string,
    year: string
  ): Promise<Set<string>> {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    try {
      const rows = await this.gateway.findWhere(
        ctx,
        'market_holidays',
        { exchange_code: exchangeCode },
        { limit: 400 }
      );
      const out = new Set<string>();
      for (const row of rows) {
        const date = String(row.holiday_date ?? row.date ?? '').slice(0, 10);
        if (date >= from && date <= to) out.add(date);
      }
      return out;
    } catch {
      return new Set();
    }
  }
}
