import type { UserContext, CoCeoDataGateway } from '../dal';
import type { ModuleCategories } from '../module-registry';

const BRAZILIAN_NATIONAL_HOLIDAYS_MM_DD = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalhador
  '09-07', // Independência
  '10-12', // Nossa Sra. Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25', // Natal
]);

/**
 * Retorna os feriados móveis (Carnaval, Sexta-feira Santa e Corpus Christi) para o ano dado.
 * Usa o algoritmo de Computus para calcular a Páscoa.
 */
function getFloatingHolidays(year: number): Set<string> {
  // Computus (Algoritmo de Meeus/Jones/Butcher)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  const easter = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  
  const addDaysToDate = (baseDate: Date, days: number) => {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + days);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  return new Set([
    addDaysToDate(easter, -48), // Segunda de Carnaval
    addDaysToDate(easter, -47), // Terça de Carnaval
    addDaysToDate(easter, -2),  // Sexta-feira Santa
    addDaysToDate(easter, 60),  // Corpus Christi
  ]);
}

const floatingHolidaysCache = new Map<number, Set<string>>();

function isBrazilianBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false; // Fim de semana

  const mm_dd = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (BRAZILIAN_NATIONAL_HOLIDAYS_MM_DD.has(mm_dd)) return false;

  const year = d.getUTCFullYear();
  let floating = floatingHolidaysCache.get(year);
  if (!floating) {
    floating = getFloatingHolidays(year);
    floatingHolidaysCache.set(year, floating);
  }
  if (floating.has(mm_dd)) return false;

  return true;
}

/**
 * Calcula settlement_date a partir de um transaction_date + perfil (D+N).
 *
 * business_days_only=true descarta sabados/domingos e feriados B3 nacionais.
 */
export class SettlementEngine {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly categories: ModuleCategories
  ) {}

  async resolveSettlementDate(
    ctx: UserContext,
    transactionDateIso: string,
    profileCode: string
  ): Promise<string> {
    const profile = await this.categories.resolveSettlement(ctx, profileCode);
    return SettlementEngine.addDays(
      transactionDateIso,
      profile.days_offset,
      Boolean(profile.business_days_only)
    );
  }

  static addDays(dateIso: string, days: number, businessDaysOnly: boolean): string {
    const d = new Date(`${dateIso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Data invalida: ${dateIso}`);
    }
    let remaining = days;
    while (remaining > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (!businessDaysOnly) {
        remaining -= 1;
        continue;
      }
      if (isBrazilianBusinessDay(d)) {
        remaining -= 1;
      }
    }
    return d.toISOString().slice(0, 10);
  }
}
