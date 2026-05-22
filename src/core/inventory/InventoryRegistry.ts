import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../dal';
import { GatewayError } from '../dal/errors';
import type { ContractGuard, ModuleCategoryRow } from '../module-registry';
import type { ModuleCategories } from '../module-registry/ModuleCategories';
import type { EnsureItemInput, PatrimonyItemRow, PatrimonyStatus } from './types';

/**
 * CRUD canonico de patrimony_items.
 *
 * Atributos especificos de modulo (PM B3, depreciacao acumulada, lote de
 * fabricacao) vivem em tabelas de extensao — nao chegam aqui.
 */
export class InventoryRegistry {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly categories: ModuleCategories,
    private readonly contractGuard: ContractGuard
  ) {}

  async findById(ctx: UserContext, id: string): Promise<PatrimonyItemRow | null> {
    return (await this.gateway.findById(ctx, 'patrimony_items', id)) as
      | PatrimonyItemRow
      | null;
  }

  async findByIdentifier(
    ctx: UserContext,
    sourceModule: string,
    identifier: string
  ): Promise<PatrimonyItemRow | null> {
    const rows = await this.gateway.findWhere(
      ctx,
      'patrimony_items',
      { source_module: sourceModule, identifier },
      { limit: 1 }
    );
    return (rows[0] as PatrimonyItemRow | undefined) ?? null;
  }

  async listByModule(
    ctx: UserContext,
    sourceModule: string,
    options: { includeLiquidated?: boolean } = {}
  ): Promise<PatrimonyItemRow[]> {
    const filters: SecurePayload = { source_module: sourceModule };
    if (!options.includeLiquidated) filters.status = 'active';
    const rows = await this.gateway.findWhere(ctx, 'patrimony_items', filters);
    return rows as PatrimonyItemRow[];
  }

  /**
   * Cria ou retorna item existente para (organization, sourceModule, identifier).
   * Resolve sourceModule a partir do ContractGuard.
   */
  async ensure(
    ctx: UserContext,
    input: EnsureItemInput
  ): Promise<{ item: PatrimonyItemRow; created: boolean; category: ModuleCategoryRow }> {
    const sourceModule = await this.contractGuard.assertCanWriteCategory(
      ctx,
      input.category,
      input.subcategory
    );
    const category = await this.categories.resolveCategory(
      ctx,
      input.category,
      input.subcategory
    );

    const existing = await this.findByIdentifier(ctx, sourceModule, input.identifier);
    if (existing) return { item: existing, created: false, category };

    const id = randomUUID();
    const payload: SecurePayload = {
      id,
      source_module: sourceModule,
      category: input.category,
      subcategory: input.subcategory,
      identifier: input.identifier,
      name: input.name ?? input.identifier,
      quantity: 0,
      quantity_unit: input.quantityUnit ?? category.default_quantity_unit,
      acquisition_value: 0,
      current_value: 0,
      currency: input.currency ?? 'BRL',
      status: 'active',
      metadata: input.metadata ?? null,
    };
    await this.gateway.insert(ctx, 'patrimony_items', payload);
    const created = await this.findById(ctx, id);
    if (!created) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `Falha ao criar patrimony_items ${id}`,
        500
      );
    }
    return { item: created, created: true, category };
  }

  async updateSnapshot(
    ctx: UserContext,
    itemId: string,
    snapshot: {
      quantity: number;
      acquisitionValue: number;
      currentValue: number;
      status?: PatrimonyStatus;
      acquiredAt?: string | null;
      divestedAt?: string | null;
    }
  ): Promise<void> {
    const payload: SecurePayload = {
      quantity: snapshot.quantity,
      acquisition_value: snapshot.acquisitionValue,
      current_value: snapshot.currentValue,
    };
    if (snapshot.status) payload.status = snapshot.status;
    if (snapshot.acquiredAt !== undefined) payload.acquired_at = snapshot.acquiredAt;
    if (snapshot.divestedAt !== undefined) payload.divested_at = snapshot.divestedAt;
    await this.gateway.update(ctx, 'patrimony_items', itemId, payload);
  }
}
