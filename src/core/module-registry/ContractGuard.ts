import type { CoCeoDataGateway, UserContext } from '../dal';
import { SYSTEM_INSTALLER_USER_ID } from '../dal/types';
import { GatewayError } from '../dal/errors';
import type { ModuleCategories } from './ModuleCategories';

/**
 * Barreira final: valida que a organizacao do contexto contratou o modulo
 * antes de aceitar escrita em patrimony_items ou financial_accounts.
 *
 * Resolve (category, subcategory) -> source_module via ModuleCategories e
 * confere contratos ativos em (contracts join contract_modules).
 *
 * Bypassado para SYSTEM_INSTALLER (seeds e bootstrap).
 */
export class ContractGuard {
  private cache = new Map<string, Set<string>>(); // organizationId -> Set<moduleCode>

  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly categories: ModuleCategories
  ) {}

  clearCache(organizationId?: string): void {
    if (organizationId) this.cache.delete(organizationId);
    else this.cache.clear();
  }

  /**
   * Valida que `ctx.organizationId` tem contrato ativo no modulo necessario
   * para (category, subcategory). Lanca FORBIDDEN_MODULE se nao tiver.
   */
  async assertCanWriteCategory(
    ctx: UserContext,
    category: string,
    subcategory: string
  ): Promise<string> {
    const row = await this.categories.resolveCategory(ctx, category, subcategory);
    await this.assertCanUseModule(ctx, row.module_code);
    return row.module_code;
  }

  async assertCanUseModule(ctx: UserContext, moduleCode: string): Promise<void> {
    if (ctx.userId === SYSTEM_INSTALLER_USER_ID) return;

    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError(
        'FORBIDDEN_MODULE',
        `Operacao em modulo ${moduleCode} requer organizationId no contexto.`,
        400
      );
    }

    const modules = await this.loadActiveModules(ctx, orgId);
    if (!modules.has(moduleCode)) {
      throw new GatewayError(
        'FORBIDDEN_MODULE',
        `Organizacao ${orgId} nao contratou o modulo ${moduleCode}.`,
        403
      );
    }
  }

  private async loadActiveModules(ctx: UserContext, orgId: string): Promise<Set<string>> {
    const hit = this.cache.get(orgId);
    if (hit) return hit;

    const contracts = await this.gateway.findWhere(ctx, 'contracts', {
      organization_id: orgId,
      status: 'active',
    });
    const set = new Set<string>();
    for (const c of contracts) {
      const contractId = String(c.id);
      const mods = await this.gateway.findWhere(ctx, 'contract_modules', {
        contract_id: contractId,
        status: 'active',
      });
      for (const m of mods) {
        const code = m.module_code ? String(m.module_code) : '';
        if (code) set.add(code);
      }
    }

    this.cache.set(orgId, set);
    return set;
  }
}
