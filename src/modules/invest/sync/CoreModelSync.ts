import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../../../core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../../../core/dal/types';
import { GatewayError } from '../../../core/dal/errors';
import { inferUnderlyingTicker } from '../../../core/invest/assetClassifier';
import { LegacyMirror } from '../legacy/LegacyMirror';
import type { InvestAssetClass } from '../types';

/**
 * Sincroniza o nucleo patrimonial canonico a partir do schema legado.
 *
 * Para cada escrita no legado feita pelo LedgerImportService (ou seeds, ou
 * qualquer outro caminho ainda nao migrado), este servico projeta no novo
 * modelo: patrimony_items + invest_position_ext + invest_option_ext +
 * financial_accounts + patrimony_ledger_entries + financial_ledger_entries.
 *
 * Idempotente: o id do invest_assets/invest_ledger_entries vira external_ref
 * no novo modelo. Re-rodar nao duplica.
 *
 * Direcao da sincronizacao: LEGADO -> NUCLEO. Enquanto o engine de leitura
 * (CustodyEngine, threePricesEngine) nao for portado, o legado segue como
 * fonte de verdade e o nucleo eh projecao mantida atualizada por este sync.
 */
export class CoreModelSync {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  private static legacyAssetTypeToClass(t: string): InvestAssetClass | 'cash' {
    switch (t) {
      case 'stock':
        return 'stock';
      case 'fii':
        return 'fii';
      case 'option_call':
        return 'option_call';
      case 'option_put':
        return 'option_put';
      case 'fixed_income':
        return 'fixed_income';
      case 'cash':
        return 'cash';
      default:
        return 'stock';
    }
  }

  /** Normaliza Date/string para 'YYYY-MM-DD'. */
  private static toIsoDate(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const y = value.getUTCFullYear();
      const m = String(value.getUTCMonth() + 1).padStart(2, '0');
      const d = String(value.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const s = String(value ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear();
      const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
      const d = String(parsed.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return s.slice(0, 10);
  }

  private static legacyOpToMovementType(op: string, signedQty: number): string {
    switch (op) {
      case 'opening_balance':
        return 'opening_balance';
      case 'buy':
      case 'bonus':
        return 'acquisition';
      case 'sell':
        return 'disposition';
      case 'split':
        return 'split';
      case 'revaluation':
        return 'revaluation';
      case 'put_sell':
      case 'call_sell':
        return signedQty < 0 ? 'short_open' : 'short_close';
      case 'put_buy':
      case 'call_buy':
        return signedQty > 0 ? 'acquisition' : 'disposition';
      case 'option_exercise':
        return signedQty >= 0 ? 'acquisition' : 'disposition';
      default:
        return 'revaluation';
    }
  }

  private static legacyOpToDirection(
    op: string,
    netValue: number
  ): { kind: 'cash' | 'inventory_with_cash' | 'cash_pending'; direction?: 'in' | 'out' } {
    if (op === 'pending_settlement') {
      return { kind: 'cash_pending', direction: netValue >= 0 ? 'in' : 'out' };
    }
    if (
      op === 'dividend' ||
      op === 'jcp' ||
      op === 'cash_yield' ||
      op === 'capital_deposit' ||
      op === 'securities_lending'
    ) {
      return { kind: 'cash', direction: netValue >= 0 ? 'in' : 'out' };
    }
    if (
      op === 'capital_withdrawal' ||
      op === 'fee' ||
      op === 'penalty_b3'
    ) {
      return { kind: 'cash', direction: netValue <= 0 ? 'out' : 'in' };
    }
    return { kind: 'inventory_with_cash', direction: netValue >= 0 ? 'in' : 'out' };
  }

  /** Constroi UserContext bypassando ContractGuard para escritas administrativas. */
  private installerCtx(ctx: UserContext): UserContext {
    return {
      userId: SYSTEM_INSTALLER_USER_ID,
      organizationId: ctx.organizationId,
      impersonatorId: null,
      scope: 'global',
    };
  }

  /**
   * Roda projecao completa do legado para a organizacao do contexto. Use
   * apos qualquer escrita do LedgerImportService que possa ter introduzido
   * novos invest_assets ou invest_ledger_entries.
   */
  async syncFromLegacy(ctx: UserContext): Promise<{
    itemsUpserted: number;
    accountsUpserted: number;
    patrimonyLedgerInserted: number;
    financialLedgerInserted: number;
  }> {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'Organização obrigatória para sincronizar nucleo a partir do legado.',
        400
      );
    }

    const installer = this.installerCtx(ctx);

    const assets = await this.gateway.findWhere(installer, 'invest_assets', {
      organization_id: orgId,
    });
    const ledger = await this.gateway.findWhere(installer, 'invest_ledger_entries', {
      organization_id: orgId,
    });

    const stats = {
      itemsUpserted: 0,
      accountsUpserted: 0,
      patrimonyLedgerInserted: 0,
      financialLedgerInserted: 0,
    };

    const legacyAssetIdToNewItemId = new Map<string, string>();
    const legacyAssetIdToAccountId = new Map<string, string>();
    let cachedCashAccountId: string | null = null;
    const ensureLegacyCash = async (): Promise<string> => {
      if (cachedCashAccountId) return cachedCashAccountId;
      cachedCashAccountId = await this.ensureDefaultCashAccount(installer, orgId);
      return cachedCashAccountId;
    };

    for (const row of assets) {
      const legacyId = String(row.id);
      const assetType = String(row.asset_type ?? '');
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      if (!ticker) continue;
      const cls = CoreModelSync.legacyAssetTypeToClass(assetType);

      if (cls === 'cash') {
        const acc = await ensureLegacyCash();
        legacyAssetIdToAccountId.set(legacyId, acc);
        continue;
      }

      const item = await this.upsertPatrimonyItem(installer, {
        ticker,
        assetClass: cls,
        underlyingTicker: this.extractUnderlying(row),
        legacyAssetId: legacyId,
      });
      legacyAssetIdToNewItemId.set(legacyId, item.id);
      stats.itemsUpserted += 1;
    }

    for (const entry of ledger) {
      const legacyEntryId = String(entry.id);
      // Lancamentos gerados pelo proprio LegacyMirror (caminho NOVO -> LEGADO)
      // ja existem no nucleo. Pular para evitar duplicacao.
      const brokerRef = String(entry.broker_note_ref ?? '');
      if (brokerRef.startsWith(LegacyMirror.MIRROR_REF)) continue;

      const existing = await this.gateway.findWhere(
        installer,
        'patrimony_ledger_entries',
        { external_ref: `LEGACY:${legacyEntryId}` },
        { limit: 1 }
      );
      const existingFinancial = await this.gateway.findWhere(
        installer,
        'financial_ledger_entries',
        { external_ref: `LEGACY:${legacyEntryId}` },
        { limit: 1 }
      );
      if (existing.length || existingFinancial.length) continue;

      const op = String(entry.transaction_type ?? '');
      const netValue = Number(entry.total_net_value ?? 0);
      const tradeDate = CoreModelSync.toIsoDate(entry.transaction_date);
      const classification = CoreModelSync.legacyOpToDirection(op, netValue);

      const legacyAssetId = String(entry.asset_id ?? '');
      const isCashAsset = legacyAssetIdToAccountId.has(legacyAssetId);
      const itemId = legacyAssetIdToNewItemId.get(legacyAssetId);

      if (classification.kind === 'cash_pending') {
        const acc = legacyAssetIdToAccountId.get(legacyAssetId) ?? (await ensureLegacyCash());
        await this.insertFinancialEntry(installer, {
          accountId: acc,
          transactionDate: tradeDate,
          settlementDate: tradeDate,
          direction: classification.direction!,
          amount: Math.abs(netValue),
          description: String(entry.notes ?? ''),
          status: 'pending',
          externalRef: `LEGACY:${legacyEntryId}`,
          metadata: { legacy_op: op, broker_note_ref: entry.broker_note_ref ?? null },
        });
        stats.financialLedgerInserted += 1;
        continue;
      }

      if (isCashAsset || classification.kind === 'cash') {
        const acc = legacyAssetIdToAccountId.get(legacyAssetId) ?? (await ensureLegacyCash());
        await this.insertFinancialEntry(installer, {
          accountId: acc,
          transactionDate: tradeDate,
          settlementDate: tradeDate,
          direction: classification.direction!,
          amount: Math.abs(netValue),
          description: String(entry.notes ?? ''),
          status: 'cleared',
          externalRef: `LEGACY:${legacyEntryId}`,
          metadata: { legacy_op: op, broker_note_ref: entry.broker_note_ref ?? null },
        });
        stats.financialLedgerInserted += 1;
        continue;
      }

      if (!itemId) continue;

      const signedQty = Number(entry.quantity ?? 0);
      const unitPrice = Number(entry.unit_price ?? 0);
      const movementType = CoreModelSync.legacyOpToMovementType(op, signedQty);

      const payload: SecurePayload = {
        id: randomUUID(),
        patrimony_item_id: itemId,
        location_id: null,
        transaction_date: tradeDate,
        movement_type: movementType,
        quantity_delta: signedQty,
        unit_value: unitPrice,
        total_value: Math.abs(signedQty) * unitPrice,
        impacts_valuation: Boolean(entry.impacts_managerial_price ?? true),
        external_ref: `LEGACY:${legacyEntryId}`,
        notes: entry.notes ?? null,
        metadata: { legacy_op: op, broker_note_ref: entry.broker_note_ref ?? null },
      };
      await this.gateway.insert(installer, 'patrimony_ledger_entries', payload);
      stats.patrimonyLedgerInserted += 1;
    }

    stats.accountsUpserted = legacyAssetIdToAccountId.size > 0 ? 1 : 0;
    return stats;
  }

  private extractUnderlying(row: Record<string, unknown>): string | null {
    const ticker = String(row.asset_ticker ?? '').toUpperCase();
    const assetType = String(row.asset_type ?? '');
    if (assetType !== 'option_call' && assetType !== 'option_put') return null;
    let meta: { underlying_ticker?: string } = {};
    if (row.metadata) {
      try {
        meta =
          typeof row.metadata === 'string'
            ? JSON.parse(String(row.metadata))
            : (row.metadata as { underlying_ticker?: string });
      } catch {
        meta = {};
      }
    }
    return inferUnderlyingTicker(ticker, meta.underlying_ticker) ?? null;
  }

  private async upsertPatrimonyItem(
    ctx: UserContext,
    input: {
      ticker: string;
      assetClass: InvestAssetClass;
      underlyingTicker: string | null;
      legacyAssetId: string;
    }
  ): Promise<{ id: string }> {
    const existing = await this.gateway.findWhere(
      ctx,
      'patrimony_items',
      { source_module: 'INVEST', identifier: input.ticker },
      { limit: 1 }
    );
    if (existing.length) {
      const id = String(existing[0].id);
      await this.ensurePositionExt(ctx, id, input);
      return { id };
    }
    const id = randomUUID();
    await this.gateway.insert(ctx, 'patrimony_items', {
      id,
      source_module: 'INVEST',
      category: 'financial_asset',
      subcategory: input.assetClass,
      identifier: input.ticker,
      name: input.ticker,
      quantity: 0,
      quantity_unit: input.assetClass === 'fii' ? 'cota' : 'un',
      acquisition_value: 0,
      current_value: 0,
      currency: 'BRL',
      status: 'active',
      metadata: JSON.stringify({ legacy_asset_id: input.legacyAssetId }),
    });
    await this.ensurePositionExt(ctx, id, input);
    return { id };
  }

  private async ensurePositionExt(
    ctx: UserContext,
    itemId: string,
    input: {
      ticker: string;
      assetClass: InvestAssetClass;
      underlyingTicker: string | null;
    }
  ): Promise<void> {
    const existing = await this.gateway.findWhere(
      ctx,
      'invest_position_ext',
      { patrimony_item_id: itemId },
      { limit: 1 }
    );
    const payload: SecurePayload = {
      asset_class: input.assetClass,
      underlying_ticker: input.underlyingTicker,
    };
    if (existing.length) {
      await this.gateway.update(ctx, 'invest_position_ext', itemId, payload);
    } else {
      await this.gateway.insert(ctx, 'invest_position_ext', {
        patrimony_item_id: itemId,
        ...payload,
      });
    }
  }

  private async ensureDefaultCashAccount(ctx: UserContext, orgId: string): Promise<string> {
    const rows = await this.gateway.findWhere(
      ctx,
      'financial_accounts',
      { source_module: 'INVEST', external_id: 'LEGACY-CASH' },
      { limit: 1 }
    );
    if (rows.length) return String(rows[0].id);

    const id = randomUUID();
    await this.gateway.insert(ctx, 'financial_accounts', {
      id,
      source_module: 'INVEST',
      account_type: 'brokerage',
      external_id: 'LEGACY-CASH',
      name: 'Caixa investimento (consolidado legado)',
      currency: 'BRL',
      opening_balance: 0,
      status: 'active',
      metadata: JSON.stringify({ derived_from_legacy: true }),
    });
    return id;
  }

  private async insertFinancialEntry(
    ctx: UserContext,
    input: {
      accountId: string;
      transactionDate: string;
      settlementDate: string;
      direction: 'in' | 'out';
      amount: number;
      description: string;
      status: 'pending' | 'cleared' | 'cancelled';
      externalRef: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    if (input.amount === 0) return;
    await this.gateway.insert(ctx, 'financial_ledger_entries', {
      id: randomUUID(),
      account_id: input.accountId,
      transaction_date: input.transactionDate,
      settlement_date: input.settlementDate,
      direction: input.direction,
      amount: Math.abs(input.amount),
      currency: 'BRL',
      description: input.description,
      counterparty: null,
      status: input.status,
      related_patrimony_ledger_id: null,
      source_batch_id: null,
      external_ref: input.externalRef,
      metadata: JSON.stringify(input.metadata),
    });
  }
}
