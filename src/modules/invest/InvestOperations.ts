import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../../core/dal';
import { GatewayError } from '../../core/dal/errors';
import type { InventoryLedger, InventoryRegistry } from '../../core/inventory';
import type {
  FinancialAccountRegistry,
  FinancialLedger,
} from '../../core/financial';
import type {
  InvestAssetClass,
  InvestPositionExtRow,
  OpeningBatchInput,
  OpeningBatchResult,
  OpeningPositionInput,
} from './types';
import { LegacyMirror } from './legacy/LegacyMirror';

/**
 * Orquestrador do modulo INVEST: combina o nucleo (inventory + financial) com
 * as extensoes invest_position_ext e invest_option_ext.
 *
 * E o ponto unico de entrada do dominio: importa abertura, registra operacao
 * de mercado, exercicio de opcao etc. Substitui o antigo LedgerImportService
 * (que sera reconstruido como camada de compatibilidade chamando isto aqui).
 */
export class InvestOperations {
  private readonly legacyMirror: LegacyMirror;

  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly inventoryRegistry: InventoryRegistry,
    private readonly inventoryLedger: InventoryLedger,
    private readonly accountRegistry: FinancialAccountRegistry,
    private readonly financialLedger: FinancialLedger
  ) {
    this.legacyMirror = new LegacyMirror(gateway);
  }

  /** Categoria canonica em module_categories.subcategory para cada asset_class. */
  private static subcategoryOf(cls: InvestAssetClass): string {
    return cls;
  }

  private async upsertPositionExt(
    ctx: UserContext,
    itemId: string,
    cls: InvestAssetClass,
    extra: Partial<InvestPositionExtRow> = {}
  ): Promise<void> {
    const rows = (await this.gateway.findWhere(
      ctx,
      'invest_position_ext',
      { patrimony_item_id: itemId },
      { limit: 1 }
    )) as InvestPositionExtRow[];

    const payload: SecurePayload = {
      asset_class: cls,
      underlying_ticker: extra.underlying_ticker ?? null,
      pm_estrito: extra.pm_estrito ?? null,
      pm_b3: extra.pm_b3 ?? null,
      pm_gerencial: extra.pm_gerencial ?? null,
      last_price: extra.last_price ?? null,
      last_price_as_of: extra.last_price_as_of ?? null,
      sector: extra.sector ?? null,
      issuer_name: extra.issuer_name ?? null,
      metadata: extra.metadata ?? null,
    };

    if (rows.length === 0) {
      await this.gateway.insert(ctx, 'invest_position_ext', {
        patrimony_item_id: itemId,
        ...payload,
      });
    } else {
      await this.gateway.update(ctx, 'invest_position_ext', itemId, payload);
    }
  }

  private async upsertOptionExt(
    ctx: UserContext,
    itemId: string,
    input: {
      optionType: 'CALL' | 'PUT';
      underlyingTicker: string;
      strikePrice: number;
      expirationDate: string;
    }
  ): Promise<void> {
    const rows = await this.gateway.findWhere(
      ctx,
      'invest_option_ext',
      { patrimony_item_id: itemId },
      { limit: 1 }
    );
    const payload: SecurePayload = {
      option_type: input.optionType,
      underlying_ticker: input.underlyingTicker,
      strike_price: input.strikePrice,
      expiration_date: input.expirationDate,
      european_american: 'A',
    };
    if (rows.length === 0) {
      await this.gateway.insert(ctx, 'invest_option_ext', {
        patrimony_item_id: itemId,
        ...payload,
      });
    } else {
      await this.gateway.update(ctx, 'invest_option_ext', itemId, payload);
    }
  }

  /**
   * Importa um saldo inicial de posicao (acao, opcao, FII, renda fixa).
   * Cria o patrimony_item, registra opening_balance no inventory_ledger e
   * sincroniza invest_position_ext (e invest_option_ext quando aplicavel).
   *
   * Espelha em invest_assets/invest_ledger_entries via LegacyMirror para
   * manter compatibilidade com codigo antigo (will be removed).
   */
  async recordOpeningPosition(
    ctx: UserContext,
    asOfDate: string,
    input: OpeningPositionInput,
    options: { legacyBatchId?: string } = {}
  ): Promise<{ itemId: string; entryId: string }> {
    if (input.assetClass === 'option_call' || input.assetClass === 'option_put') {
      if (!input.optionUnderlying || !input.optionStrike || !input.optionExpiration) {
        throw new GatewayError(
          'INVALID_PAYLOAD',
          `Opcao ${input.ticker} exige underlying, strike e expiration.`,
          400
        );
      }
    }

    const { item } = await this.inventoryRegistry.ensure(ctx, {
      category: 'financial_asset',
      subcategory: InvestOperations.subcategoryOf(input.assetClass),
      identifier: input.ticker,
      name: input.name ?? input.ticker,
    });

    const { entry, state } = await this.inventoryLedger.recordMovement(ctx, {
      itemId: item.id,
      transactionDate: asOfDate,
      movementType: 'opening_balance',
      quantityDelta: input.quantity,
      unitValue: input.unitPrice,
      notes: input.notes ?? 'Saldo inicial',
    });

    await this.upsertPositionExt(ctx, item.id, input.assetClass, {
      underlying_ticker: input.optionUnderlying ?? null,
      pm_estrito: state.pmA,
      pm_b3: state.pmB,
      pm_gerencial: state.pmC,
    });

    if (input.assetClass === 'option_call' || input.assetClass === 'option_put') {
      await this.upsertOptionExt(ctx, item.id, {
        optionType: input.assetClass === 'option_call' ? 'CALL' : 'PUT',
        underlyingTicker: input.optionUnderlying!,
        strikePrice: input.optionStrike!,
        expirationDate: input.optionExpiration!,
      });
    }

    if (ctx.organizationId) {
      const legacyAssetId = await this.legacyMirror.ensureLegacyAsset(
        ctx,
        ctx.organizationId,
        input
      );
      await this.legacyMirror.recordLegacyOpeningEntry(
        ctx,
        legacyAssetId,
        asOfDate,
        input,
        options.legacyBatchId ?? randomUUID()
      );
    }

    return { itemId: item.id, entryId: entry.id };
  }

  /**
   * Importa abertura de uma conta de caixa em corretora. Cria o
   * financial_account e registra um lancamento "opening_balance" como
   * direction='in' (mesmo que o saldo seja zero ou negativo).
   *
   * Saldo negativo (overdraft) eh permitido — eh status normal de quem
   * deixa B3 cobrar liquidacao D+N do caixa.
   */
  async recordOpeningCash(
    ctx: UserContext,
    asOfDate: string,
    input: {
      brokerCode: string;
      accountName?: string;
      externalId?: string;
      balance: number;
    }
  ): Promise<{ accountId: string; entryId: string | null }> {
    const name = input.accountName ?? `Caixa ${input.brokerCode}`;
    const account = await this.accountRegistry.register(ctx, {
      sourceModule: 'INVEST',
      accountType: 'brokerage',
      name,
      externalId: input.externalId ?? input.brokerCode,
      openingBalance: input.balance,
      openingDate: asOfDate,
      metadata: { broker_code: input.brokerCode },
    });

    if (input.balance === 0) {
      return { accountId: account.id, entryId: null };
    }

    const entry = await this.financialLedger.record(ctx, {
      accountId: account.id,
      transactionDate: asOfDate,
      direction: input.balance >= 0 ? 'in' : 'out',
      amount: Math.abs(input.balance),
      description: 'Saldo inicial',
      status: 'cleared',
      settlementDate: asOfDate,
    });

    return { accountId: account.id, entryId: entry.id };
  }

  /**
   * Executa um batch de abertura inteiro de uma vez. Recomendado para o
   * bootstrap inicial da holding ou para reset de ano fiscal.
   */
  async recordOpeningBatch(
    ctx: UserContext,
    input: OpeningBatchInput
  ): Promise<OpeningBatchResult> {
    const result: OpeningBatchResult = {
      patrimonyItemsCreated: 0,
      ledgerEntriesCreated: 0,
      cashAccountsCreated: 0,
      cashEntriesCreated: 0,
      longsValue: 0,
      shortsValue: 0,
      cashTotal: 0,
      totalPatrimony: 0,
    };

    const legacyBatchId = randomUUID();
    for (const p of input.positions) {
      const before = await this.inventoryRegistry.findByIdentifier(
        ctx,
        'INVEST',
        p.ticker
      );
      const { entryId } = await this.recordOpeningPosition(ctx, input.asOfDate, p, {
        legacyBatchId,
      });
      if (!before) result.patrimonyItemsCreated += 1;
      if (entryId) result.ledgerEntriesCreated += 1;
      const value = p.quantity * p.unitPrice;
      if (value >= 0) result.longsValue += value;
      else result.shortsValue += value;
    }

    for (const c of input.cashAccounts) {
      const beforeAcc = await this.accountRegistry.findByExternalId(
        ctx,
        'INVEST',
        c.externalId ?? c.brokerCode
      );
      const { entryId } = await this.recordOpeningCash(ctx, input.asOfDate, {
        brokerCode: c.brokerCode,
        accountName: c.accountName,
        externalId: c.externalId,
        balance: c.balance,
      });
      if (!beforeAcc) result.cashAccountsCreated += 1;
      if (entryId) result.cashEntriesCreated += 1;
      result.cashTotal += c.balance;
    }

    result.totalPatrimony = result.longsValue + result.shortsValue + result.cashTotal;
    return result;
  }
}
