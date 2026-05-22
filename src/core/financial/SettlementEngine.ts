import type { UserContext, CoCeoDataGateway } from '../dal';
import type { ModuleCategories } from '../module-registry';

/**
 * Calcula settlement_date a partir de um transaction_date + perfil (D+N).
 *
 * business_days_only=true descarta sabados/domingos. Feriados B3 nao estao
 * implementados ainda — TODO: trazer da B3 ou de uma tabela de feriados.
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
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) remaining -= 1;
    }
    return d.toISOString().slice(0, 10);
  }
}
