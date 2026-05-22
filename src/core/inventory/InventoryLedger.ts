import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../dal';
import { GatewayError } from '../dal/errors';
import type { InventoryRegistry } from './InventoryRegistry';
import type { ValuationFactory } from './valuation/ValuationFactory';
import type {
  PatrimonyItemRow,
  PatrimonyLedgerRow,
  PositionState,
  RecordMovementInput,
} from './types';

/**
 * Livro razao canonico de posicoes patrimoniais.
 *
 * Cada lancamento recalcula PM(s) via estrategia de valoracao do modulo
 * (resolvida em module_categories.default_valuation_method, mas o caller
 * pode injetar override) e atualiza o snapshot em patrimony_items.
 *
 * NAO move dinheiro — a perna financeira eh responsabilidade do caller
 * (orquestrador de modulo) via FinancialLedger.
 */
export class InventoryLedger {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly registry: InventoryRegistry,
    private readonly valuationFactory: ValuationFactory
  ) {}

  /**
   * Carrega lancamentos do item em ordem cronologica + sequencial de criacao,
   * para reconstrucao deterministica do estado.
   */
  private async loadOrderedLedger(
    ctx: UserContext,
    itemId: string
  ): Promise<PatrimonyLedgerRow[]> {
    const rows = (await this.gateway.findWhere(ctx, 'patrimony_ledger_entries', {
      patrimony_item_id: itemId,
    })) as PatrimonyLedgerRow[];
    return rows
      .filter((r) => !(r as unknown as { deleted_at?: string | null }).deleted_at)
      .sort((a, b) => {
        if (a.transaction_date !== b.transaction_date) {
          return a.transaction_date < b.transaction_date ? -1 : 1;
        }
        const ca = (a as unknown as { created_at?: string }).created_at ?? '';
        const cb = (b as unknown as { created_at?: string }).created_at ?? '';
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
  }

  private static initialState(): PositionState {
    return {
      quantity: 0,
      pmA: 0,
      pmB: null,
      pmC: null,
      acquisitionValue: 0,
      currentValue: 0,
    };
  }

  /**
   * Parse defensivo do metadata (que pode vir como string JSON do MySQL ou ja
   * como objeto JS). Devolve `null` para qualquer formato invalido para nao
   * quebrar o replay.
   */
  private static parseMetadata(raw: unknown): Record<string, unknown> | null {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === 'object' && parsed != null
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Rebuild integral. Util apos correcoes ou para conciliacao. */
  async rebuildPosition(
    ctx: UserContext,
    itemId: string,
    methodCode?: string
  ): Promise<PositionState> {
    const item = await this.registry.findById(ctx, itemId);
    if (!item) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `patrimony_items ${itemId} nao encontrado`,
        404
      );
    }
    const resolvedMethod = methodCode ?? (await this.resolveMethodFor(ctx, item));
    const valuation = await this.valuationFactory.build(ctx, resolvedMethod);
    let state = InventoryLedger.initialState();
    const ledger = await this.loadOrderedLedger(ctx, itemId);
    for (const row of ledger) {
      state = valuation.applyMovement(state, {
        itemId,
        locationId: row.location_id,
        transactionDate: row.transaction_date,
        movementType: row.movement_type,
        quantityDelta: Number(row.quantity_delta),
        unitValue: Number(row.unit_value),
        impactsValuation: Boolean(row.impacts_valuation),
        externalRef: row.external_ref,
        metadata: InventoryLedger.parseMetadata(row.metadata),
      });
    }
    return state;
  }

  private async resolveMethodFor(
    ctx: UserContext,
    item: PatrimonyItemRow
  ): Promise<string> {
    const categories = (await this.gateway.findWhere(ctx, 'module_categories', {
      module_code: item.source_module,
      category: item.category,
      subcategory: item.subcategory,
    })) as Array<{ default_valuation_method: string }>;
    if (!categories.length) {
      throw new GatewayError(
        'UNKNOWN_SUBCATEGORY',
        `Sem entrada em module_categories para ${item.source_module}/${item.category}/${item.subcategory}.`,
        400
      );
    }
    return categories[0].default_valuation_method;
  }

  /**
   * Registra um movimento e atualiza o snapshot. Retorna a linha gravada e o
   * novo estado computado.
   */
  async recordMovement(
    ctx: UserContext,
    input: RecordMovementInput,
    options: { valuationMethod?: string } = {}
  ): Promise<{ entry: PatrimonyLedgerRow; state: PositionState }> {
    const item = await this.registry.findById(ctx, input.itemId);
    if (!item) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `patrimony_items ${input.itemId} nao encontrado`,
        404
      );
    }
    const method = options.valuationMethod ?? (await this.resolveMethodFor(ctx, item));
    const valuation = await this.valuationFactory.build(ctx, method);

    const ledger = await this.loadOrderedLedger(ctx, input.itemId);
    let state = InventoryLedger.initialState();
    for (const row of ledger) {
      state = valuation.applyMovement(state, {
        itemId: input.itemId,
        locationId: row.location_id,
        transactionDate: row.transaction_date,
        movementType: row.movement_type,
        quantityDelta: Number(row.quantity_delta),
        unitValue: Number(row.unit_value),
        impactsValuation: Boolean(row.impacts_valuation),
        externalRef: row.external_ref,
        metadata: InventoryLedger.parseMetadata(row.metadata),
      });
    }
    const next = valuation.applyMovement(state, input);

    const totalValue =
      input.quantityDelta === 0
        ? input.unitValue
        : Math.abs(input.quantityDelta) * input.unitValue;

    const entryId = randomUUID();
    const payload: SecurePayload = {
      id: entryId,
      patrimony_item_id: input.itemId,
      location_id: input.locationId ?? null,
      transaction_date: input.transactionDate,
      movement_type: input.movementType,
      quantity_delta: input.quantityDelta,
      unit_value: input.unitValue,
      total_value: totalValue,
      impacts_valuation: input.impactsValuation ?? true,
      business_event_id: input.businessEventId ?? null,
      source_batch_id: input.sourceBatchId ?? null,
      external_ref: input.externalRef ?? null,
      notes: input.notes ?? null,
      metadata:
        input.metadata == null
          ? null
          : typeof input.metadata === 'string'
          ? input.metadata
          : JSON.stringify(input.metadata),
    };
    await this.gateway.insert(ctx, 'patrimony_ledger_entries', payload);

    const acquiredAt =
      !item.acquired_at && (input.movementType === 'opening_balance' || input.movementType === 'acquisition')
        ? input.transactionDate
        : undefined;

    const divestedAt =
      next.quantity === 0 && state.quantity !== 0 ? input.transactionDate : undefined;

    const status =
      next.quantity === 0 && state.quantity !== 0 ? 'liquidated' : undefined;

    await this.registry.updateSnapshot(ctx, input.itemId, {
      quantity: next.quantity,
      acquisitionValue: next.acquisitionValue,
      currentValue: next.currentValue,
      status,
      acquiredAt,
      divestedAt,
    });

    const entry = (await this.gateway.findById(
      ctx,
      'patrimony_ledger_entries',
      entryId
    )) as PatrimonyLedgerRow;
    return { entry, state: next };
  }

  /** Liga a perna patrimonial a uma perna financeira ja criada. */
  async linkToFinancialLedger(
    ctx: UserContext,
    patrimonyLedgerId: string,
    financialLedgerId: string
  ): Promise<void> {
    await this.gateway.update(ctx, 'patrimony_ledger_entries', patrimonyLedgerId, {
      related_financial_entry_id: financialLedgerId,
    });
  }

  /**
   * Rebuild + persistencia: recalcula o estado lendo o livro razao do item
   * e grava no snapshot (patrimony_items). Use depois de soft-deletar pernas
   * (ex: voidEvent/amendEvent) pra reconciliar quantidade/valor.
   *
   * Se o livro ficou vazio (todas as pernas anuladas), grava quantity=0 e
   * acquisitionValue/currentValue=0.
   */
  async rebuildAndPersist(
    ctx: UserContext,
    itemId: string,
    methodCode?: string
  ): Promise<PositionState> {
    const state = await this.rebuildPosition(ctx, itemId, methodCode);
    await this.registry.updateSnapshot(ctx, itemId, {
      quantity: state.quantity,
      acquisitionValue: state.acquisitionValue,
      currentValue: state.currentValue,
    });
    return state;
  }
}
