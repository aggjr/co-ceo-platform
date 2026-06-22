import type { CoCeoDataGateway, UserContext } from '../dal';

export const DEFAULT_B3_EXCHANGE_CODE = 'B3_BR';

function isWeekendUtc(isoDate: string): boolean {
  const dow = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Apenas fim de semana (sem DB). Feriados: use MarketCalendarService.isHoliday. */
export function isB3Weekend(isoDate: string): boolean {
  return isWeekendUtc(isoDate.slice(0, 10));
}

/**
 * Calendario de mercado canonico: feriados exclusivamente em market_holidays (catalogo global).
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
    return yearSet.has(day);
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
