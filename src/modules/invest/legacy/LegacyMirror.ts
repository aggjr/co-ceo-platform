import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../../../core/dal';
import type {
  InvestAssetClass,
  OpeningPositionInput,
} from '../types';

/**
 * Espelhamento read-write das tabelas legadas (invest_assets,
 * invest_ledger_entries) a partir das operacoes do novo nucleo.
 *
 * Objetivo: enquanto controllers/services antigos continuam lendo o schema
 * legado, o nucleo canonico mantem essas tabelas sincronizadas. Caixa nao
 * eh espelhado — eh APENAS financial_accounts agora (correcao arquitetural
 * fundamental que motivou a refatoracao).
 *
 * Esta classe sera removida quando todos os leitores migrarem para
 * patrimony_items + invest_position_ext.
 */
export class LegacyMirror {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /** Mapeia asset_class do novo modelo para invest_assets.asset_type. */
  private static legacyAssetType(cls: InvestAssetClass): string {
    switch (cls) {
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
      case 'etf':
        return 'stock';
      case 'bdr':
        return 'stock';
      default:
        return 'stock';
    }
  }

  /**
   * Garante que existe linha em invest_assets para o ticker — com sinal de
   * quantidade preservado (negativo para shorts) e PM gerencial preenchido.
   * Retorna o id legado, que sera usado como `asset_id` no ledger legado.
   */
  async ensureLegacyAsset(
    ctx: UserContext,
    orgId: string,
    input: OpeningPositionInput
  ): Promise<string> {
    const ticker = input.ticker.toUpperCase();
    const existing = await this.gateway.findWhere(
      ctx,
      'invest_assets',
      { organization_id: orgId, asset_ticker: ticker },
      { limit: 1, columns: ['id'] }
    );
    if (existing[0]?.id) {
      const id = String(existing[0].id);
      await this.gateway.update(ctx, 'invest_assets', id, {
        asset_type: LegacyMirror.legacyAssetType(input.assetClass),
        current_quantity: input.quantity,
        managerial_avg_price: input.unitPrice,
        status: 'active',
        metadata: this.buildLegacyMetadata(input),
      });
      return id;
    }

    const id = randomUUID();
    await this.gateway.insert(ctx, 'invest_assets', {
      id,
      asset_ticker: ticker,
      asset_type: LegacyMirror.legacyAssetType(input.assetClass),
      current_quantity: input.quantity,
      managerial_avg_price: input.unitPrice,
      status: 'active',
      metadata: this.buildLegacyMetadata(input),
    });
    return id;
  }

  /**
   * Espelha um lancamento `opening_balance` em invest_ledger_entries no
   * formato legado.
   */
  async recordLegacyOpeningEntry(
    ctx: UserContext,
    legacyAssetId: string,
    asOfDate: string,
    input: OpeningPositionInput,
    sourceBatchId: string
  ): Promise<void> {
    const qtyAbs = Math.abs(input.quantity);
    const gross = qtyAbs * input.unitPrice;
    const signedNet = input.quantity * input.unitPrice;

    const payload: SecurePayload = {
      id: randomUUID(),
      asset_id: legacyAssetId,
      underlying_ticker: input.optionUnderlying ?? null,
      transaction_date: asOfDate,
      transaction_type: 'opening_balance',
      quantity: qtyAbs,
      unit_price: input.unitPrice,
      total_gross_value: gross,
      brokerage_fee: 0,
      b3_fees: 0,
      irrf_tax: 0,
      total_net_value: signedNet,
      impacts_managerial_price: true,
      broker_note_ref: LegacyMirror.MIRROR_REF,
      source_batch_id: sourceBatchId,
      notes: input.notes ?? 'Saldo inicial',
    };
    await this.gateway.insert(ctx, 'invest_ledger_entries', payload);
  }

  /**
   * Marca os lançamentos gerados pelo mirror (NOVO -> LEGADO) para que o
   * CoreModelSync (LEGADO -> NOVO) saiba que não precisa reprocessá-los.
   */
  static readonly MIRROR_REF = 'MIRROR-FROM-CORE';

  private buildLegacyMetadata(input: OpeningPositionInput): string | null {
    if (
      input.assetClass !== 'option_call' &&
      input.assetClass !== 'option_put'
    ) {
      return null;
    }
    const meta: Record<string, unknown> = {};
    if (input.optionStrike != null) meta.option_strike = input.optionStrike;
    if (input.optionExpiration) meta.option_expiration = input.optionExpiration;
    if (input.optionUnderlying) meta.underlying_ticker = input.optionUnderlying;
    return Object.keys(meta).length ? JSON.stringify(meta) : null;
  }
}
