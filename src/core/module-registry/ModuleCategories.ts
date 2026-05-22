import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import type {
  ModuleCategoryRow,
  SettlementProfileRow,
  ValuationMethodRow,
} from './types';

/**
 * Catalogo de categorias dominadas por cada modulo.
 *
 * Toda escrita em patrimony_items ou financial_accounts resolve aqui o
 * source_module a partir de (category, subcategory). E dado canonico — nao
 * fica hardcoded em service.
 *
 * Cache em memoria por processo: o catalogo eh estavel (migra via SQL),
 * entao recarregar nao agrega valor. Invalidacao manual via clearCache().
 */
export class ModuleCategories {
  private byCategoryKey = new Map<string, ModuleCategoryRow>();
  private byModuleCode = new Map<string, ModuleCategoryRow[]>();
  private valuationMethods = new Map<string, ValuationMethodRow>();
  private settlementProfiles = new Map<string, SettlementProfileRow>();
  private loaded = false;

  constructor(private readonly gateway: CoCeoDataGateway) {}

  private static key(category: string, subcategory: string): string {
    return `${category.toLowerCase()}::${subcategory.toLowerCase()}`;
  }

  async ensureLoaded(ctx: UserContext): Promise<void> {
    if (this.loaded) return;

    const categories = (await this.gateway.findWhere(ctx, 'module_categories', {
      is_active: 1,
    })) as unknown as ModuleCategoryRow[];

    for (const row of categories) {
      this.byCategoryKey.set(ModuleCategories.key(row.category, row.subcategory), row);
      const list = this.byModuleCode.get(row.module_code) ?? [];
      list.push(row);
      this.byModuleCode.set(row.module_code, list);
    }

    const methods = (await this.gateway.findWhere(ctx, 'module_valuation_methods', {
      is_active: 1,
    })) as unknown as ValuationMethodRow[];
    for (const m of methods) this.valuationMethods.set(m.method_code, m);

    const profiles = (await this.gateway.findWhere(ctx, 'module_settlement_profiles', {
      is_active: 1,
    })) as unknown as SettlementProfileRow[];
    for (const p of profiles) this.settlementProfiles.set(p.profile_code, p);

    this.loaded = true;
  }

  clearCache(): void {
    this.byCategoryKey.clear();
    this.byModuleCode.clear();
    this.valuationMethods.clear();
    this.settlementProfiles.clear();
    this.loaded = false;
  }

  /** Resolve (category, subcategory) -> linha do registry. */
  async resolveCategory(
    ctx: UserContext,
    category: string,
    subcategory: string
  ): Promise<ModuleCategoryRow> {
    await this.ensureLoaded(ctx);
    const hit = this.byCategoryKey.get(ModuleCategories.key(category, subcategory));
    if (!hit) {
      throw new GatewayError(
        'UNKNOWN_SUBCATEGORY',
        `Subcategoria ${category}/${subcategory} nao esta registrada em module_categories.`,
        400
      );
    }
    return hit;
  }

  async resolveValuation(ctx: UserContext, methodCode: string): Promise<ValuationMethodRow> {
    await this.ensureLoaded(ctx);
    const hit = this.valuationMethods.get(methodCode);
    if (!hit) {
      throw new GatewayError(
        'UNKNOWN_VALUATION_METHOD',
        `Metodo de valoracao desconhecido: ${methodCode}`,
        400
      );
    }
    return hit;
  }

  async resolveSettlement(
    ctx: UserContext,
    profileCode: string
  ): Promise<SettlementProfileRow> {
    await this.ensureLoaded(ctx);
    const hit = this.settlementProfiles.get(profileCode);
    if (!hit) {
      throw new GatewayError(
        'UNKNOWN_SETTLEMENT_PROFILE',
        `Perfil de liquidacao desconhecido: ${profileCode}`,
        400
      );
    }
    return hit;
  }

  async listForModule(ctx: UserContext, moduleCode: string): Promise<ModuleCategoryRow[]> {
    await this.ensureLoaded(ctx);
    return this.byModuleCode.get(moduleCode) ?? [];
  }
}
