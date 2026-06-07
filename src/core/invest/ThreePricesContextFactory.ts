import type { CoCeoDataGateway, UserContext } from '../dal';
import type { ThreePricesContext } from './ledgerTypes';

type AssetTypeRow = {
  asset_type: string;
  is_stock_like: number;
  is_option_like: number;
  is_active: number;
};

type IgnoredTxRow = {
  operation_type: string;
  is_active: number;
};

/**
 * Constrói um ThreePricesContext carregando configurações do banco.
 *
 * Substitui os Sets hardcoded STOCK_LIKE, OPTION_LIKE e IGNORED_TX
 * que existiam no engine antes da refatoração.
 *
 * Cache por processo: as tabelas são estáveis (alteradas apenas via migration).
 * Use clearCache() em testes ou após migration administrativa.
 */
export class ThreePricesContextFactory {
  private assetTypeCache: Map<string, { isStockLike: boolean; isOptionLike: boolean }> | null =
    null;
  private ignoredTxCache: Set<string> | null = null;

  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Constrói o contexto a partir do banco.
   * Se as tabelas não existirem ainda (antes da migration),
   * usa fallback com tipos mínimos para não quebrar o sistema.
   */
  async build(ctx: UserContext): Promise<ThreePricesContext> {
    await this.ensureLoaded(ctx);
    const assetTypes = this.assetTypeCache!;
    const ignoredTx = this.ignoredTxCache!;

    return {
      isStockLike(assetType: string): boolean {
        return assetTypes.get(assetType)?.isStockLike === true;
      },
      isOptionLike(assetType: string): boolean {
        return assetTypes.get(assetType)?.isOptionLike === true;
      },
      isIgnoredTransaction(operationType: string): boolean {
        return ignoredTx.has(operationType);
      },
    };
  }

  clearCache(): void {
    this.assetTypeCache = null;
    this.ignoredTxCache = null;
  }

  private async ensureLoaded(ctx: UserContext): Promise<void> {
    if (this.assetTypeCache !== null && this.ignoredTxCache !== null) return;

    try {
      const [assetRows, ignoredRows] = await Promise.all([
        this.gateway.findWhere(ctx, 'invest_asset_type_config', { is_active: 1 }),
        this.gateway.findWhere(ctx, 'invest_ignored_tx_config', { is_active: 1 }),
      ]);

      this.assetTypeCache = new Map(
        (assetRows as AssetTypeRow[]).map((r) => [
          r.asset_type,
          { isStockLike: r.is_stock_like === 1, isOptionLike: r.is_option_like === 1 },
        ])
      );

      this.ignoredTxCache = new Set(
        (ignoredRows as IgnoredTxRow[]).map((r) => r.operation_type)
      );
    } catch {
      // Fallback: tabelas ainda não existem (antes da migration).
      // Usa os tipos mínimos para o sistema não quebrar.
      this.assetTypeCache = new Map([
        ['stock',       { isStockLike: true,  isOptionLike: false }],
        ['fii',         { isStockLike: true,  isOptionLike: false }],
        ['option_call', { isStockLike: false, isOptionLike: true  }],
        ['option_put',  { isStockLike: false, isOptionLike: true  }],
      ]);
      this.ignoredTxCache = new Set([
        'dividend',
        'jcp',
        'cash_yield',
        'securities_lending',
        'capital_deposit',
        'capital_withdrawal',
        'penalty_b3',
        'fee',
        'revaluation',
        'pending_settlement',
      ]);
    }
  }
}
