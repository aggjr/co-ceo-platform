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
import { inferAssetType, inferUnderlyingTicker } from '../../core/invest/assetClassifier';
import type { LedgerImportLine } from '../../core/invest/ledgerTypes';

const PASSIVE_INCOME_OPS = new Set(['dividend', 'jcp', 'cash_yield', 'securities_lending']);
const PASSIVE_EXPENSE_OPS = new Set(['fee', 'penalty_b3']);
const CAPITAL_OPS = new Set(['capital_deposit', 'capital_withdrawal']);
const OPTION_OPS = new Set(['put_sell', 'put_buy', 'call_sell', 'call_buy']);
const TRADE_OPS = new Set(['buy', 'sell']);

/**
 * Orquestrador do modulo INVEST: combina o nucleo (inventory + financial) com
 * as extensoes invest_position_ext e invest_option_ext.
 *
 * E o ponto unico de entrada do dominio: importa abertura, registra operacao
 * de mercado, exercicio de opcao etc. Substitui o antigo LedgerImportService
 * (que sera reconstruido como camada de compatibilidade chamando isto aqui).
 */
export class InvestOperations {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly inventoryRegistry: InventoryRegistry,
    private readonly inventoryLedger: InventoryLedger,
    private readonly accountRegistry: FinancialAccountRegistry,
    private readonly financialLedger: FinancialLedger
  ) {}

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

    void options;
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
      metadata: { legacy_op: 'opening_balance' },
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

  /**
   * Verifica se ja existe lancamento com este broker_note_ref para evitar
   * duplicacao (idempotencia para reimport de nota).
   */
  private async hasExistingByRef(ctx: UserContext, ref: string): Promise<boolean> {
    if (!ref) return false;
    const inv = await this.gateway.findWhere(
      ctx,
      'patrimony_ledger_entries',
      { external_ref: `BROKER_REF:${ref}` },
      { limit: 1 }
    );
    if (inv.length) return true;
    const fin = await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      { external_ref: `BROKER_REF:${ref}` },
      { limit: 1 }
    );
    return fin.length > 0;
  }

  private static cashTickerToExternalId(ticker: string): string | null {
    const upper = ticker.toUpperCase();
    if (!upper.startsWith('CAIXA-')) return null;
    return upper.slice('CAIXA-'.length) || 'CASH';
  }

  /**
   * Resolve a conta de caixa canonica para um lancamento financeiro. Se o
   * ticker eh CAIXA-X, busca por external_id=X. Se nao, usa a primeira conta
   * INVEST da org (fallback). Cria sob demanda.
   */
  private async resolveCashAccount(
    ctx: UserContext,
    ticker: string,
    asOfDate: string
  ): Promise<{ accountId: string }> {
    const external = InvestOperations.cashTickerToExternalId(ticker) ?? 'CASH';
    let account = await this.accountRegistry.findByExternalId(ctx, 'INVEST', external);
    if (!account) {
      account = await this.accountRegistry.register(ctx, {
        sourceModule: 'INVEST',
        accountType: 'brokerage',
        name: `Caixa ${external}`,
        externalId: external,
        openingBalance: 0,
        openingDate: asOfDate,
      });
    }
    return { accountId: account.id };
  }

  /**
   * Ponto unico para registrar uma operacao do livro razao (compra, venda,
   * opcao, dividendo, etc.) lido de payload externo (LedgerImportLine).
   *
   * Despacha:
   *   - movimentos com ativo (buy/sell/option/exercise/split/bonus) =>
   *     inventoryLedger.recordMovement + (opcional) financialLedger.record
   *     para a perna de caixa em settlement_date.
   *   - movimentos puramente financeiros (dividend/jcp/cash_yield/fee/etc.)
   *     => apenas financialLedger.record.
   */
  async recordOperation(
    ctx: UserContext,
    line: LedgerImportLine
  ): Promise<{ skipped: boolean; reason?: string }> {
    const op = String(line.operation);
    const ticker = String(line.ticker || '').toUpperCase().trim();
    if (!ticker) {
      return { skipped: true, reason: 'ticker vazio' };
    }
    const ref = line.broker_note_ref?.trim();
    if (ref && (await this.hasExistingByRef(ctx, ref))) {
      return { skipped: true, reason: `broker_note_ref ${ref} ja registrado` };
    }

    const declaredType = String(line.asset_type ?? '').trim();
    const assetType = declaredType || inferAssetType(ticker);
    const isCash = assetType === 'cash' || ticker.startsWith('CAIXA-');

    // Opening_balance vai pelo caminho dedicado.
    if (op === 'opening_balance') {
      if (isCash) {
        await this.recordOpeningCash(ctx, line.date, {
          brokerCode: InvestOperations.cashTickerToExternalId(ticker) ?? 'CASH',
          externalId: InvestOperations.cashTickerToExternalId(ticker) ?? 'CASH',
          balance: Number(line.unit_price || line.total_net_value || 0) * (Number(line.quantity) || 1),
        });
        return { skipped: false };
      }
      const cls = (assetType as InvestAssetClass);
      await this.recordOpeningPosition(ctx, line.date, {
        ticker,
        assetClass: cls,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unit_price),
        optionUnderlying: inferUnderlyingTicker(ticker, line.underlying_ticker) ?? undefined,
        optionStrike: line.option_strike,
        notes: line.notes,
      });
      return { skipped: false };
    }

    if (PASSIVE_INCOME_OPS.has(op) || CAPITAL_OPS.has(op)) {
      const { accountId } = await this.resolveCashAccount(ctx, ticker, line.date);
      const direction: 'in' | 'out' = op === 'capital_withdrawal' ? 'out' : 'in';
      const amount = Math.abs(
        Number(line.total_net_value ?? Number(line.quantity) * Number(line.unit_price))
      );
      if (amount === 0) return { skipped: true, reason: 'amount zero' };
      await this.financialLedger.record(ctx, {
        accountId,
        transactionDate: line.date,
        direction,
        amount,
        description: line.notes ?? op,
        status: 'cleared',
        settlementDate: line.settlement_date ?? line.date,
        externalRef: ref ? `BROKER_REF:${ref}` : null,
        metadata: { legacy_op: op, broker_note_ref: ref ?? null },
      });
      return { skipped: false };
    }

    if (PASSIVE_EXPENSE_OPS.has(op)) {
      const { accountId } = await this.resolveCashAccount(ctx, ticker, line.date);
      const amount = Math.abs(
        Number(line.total_net_value ?? Number(line.quantity) * Number(line.unit_price))
      );
      if (amount === 0) return { skipped: true, reason: 'amount zero' };
      await this.financialLedger.record(ctx, {
        accountId,
        transactionDate: line.date,
        direction: 'out',
        amount,
        description: line.notes ?? op,
        status: 'cleared',
        settlementDate: line.settlement_date ?? line.date,
        externalRef: ref ? `BROKER_REF:${ref}` : null,
        metadata: { legacy_op: op, broker_note_ref: ref ?? null },
      });
      return { skipped: false };
    }

    if (op === 'pending_settlement') {
      const { accountId } = await this.resolveCashAccount(ctx, ticker, line.date);
      const netValue = Number(line.total_net_value ?? 0);
      const direction: 'in' | 'out' = netValue >= 0 ? 'in' : 'out';
      const amount = Math.abs(netValue);
      if (amount === 0) return { skipped: true, reason: 'amount zero' };
      await this.financialLedger.record(ctx, {
        accountId,
        transactionDate: line.date,
        direction,
        amount,
        description: line.notes ?? 'Valor em transito',
        status: 'pending',
        settlementDate: line.settlement_date ?? line.date,
        externalRef: ref ? `BROKER_REF:${ref}` : null,
        metadata: { legacy_op: op, broker_note_ref: ref ?? null },
      });
      return { skipped: false };
    }

    // Trade ou opcao: precisa de patrimony_item.
    if (isCash) {
      return { skipped: true, reason: `operacao ${op} nao se aplica a ticker de caixa ${ticker}` };
    }

    const assetClass = assetType as InvestAssetClass;
    const { item } = await this.inventoryRegistry.ensure(ctx, {
      category: 'financial_asset',
      subcategory: InvestOperations.subcategoryOf(assetClass),
      identifier: ticker,
      name: ticker,
    });

    let movementType:
      | 'opening_balance'
      | 'acquisition'
      | 'disposition'
      | 'split'
      | 'bonus'
      | 'revaluation'
      | 'short_open'
      | 'short_close';
    let quantityDelta: number;
    let cashDirection: 'in' | 'out' | null = null;

    if (TRADE_OPS.has(op)) {
      movementType = op === 'buy' ? 'acquisition' : 'disposition';
      quantityDelta = op === 'buy' ? Math.abs(line.quantity) : -Math.abs(line.quantity);
      cashDirection = op === 'buy' ? 'out' : 'in';
    } else if (OPTION_OPS.has(op)) {
      if (op === 'put_sell' || op === 'call_sell') {
        movementType = 'short_open';
        quantityDelta = -Math.abs(line.quantity);
        cashDirection = 'in';
      } else {
        movementType = 'short_close';
        quantityDelta = Math.abs(line.quantity);
        cashDirection = 'out';
      }
    } else if (op === 'option_exercise') {
      const signed = Number(line.quantity);
      movementType = signed >= 0 ? 'acquisition' : 'disposition';
      quantityDelta = signed;
      const netValue = Number(line.total_net_value ?? 0);
      cashDirection = netValue >= 0 ? 'in' : 'out';
    } else if (op === 'split') {
      movementType = 'split';
      quantityDelta = Number(line.quantity);
    } else if (op === 'bonus') {
      movementType = 'bonus';
      quantityDelta = Math.abs(line.quantity);
    } else if (op === 'revaluation') {
      movementType = 'revaluation';
      quantityDelta = 0;
    } else {
      return { skipped: true, reason: `operacao desconhecida: ${op}` };
    }

    await this.inventoryLedger.recordMovement(ctx, {
      itemId: item.id,
      transactionDate: line.date,
      movementType,
      quantityDelta,
      unitValue: Number(line.unit_price),
      notes: line.notes ?? op,
      externalRef: ref ? `BROKER_REF:${ref}` : undefined,
      metadata: { legacy_op: op, broker_note_ref: ref ?? null },
    });

    if (cashDirection) {
      const { accountId } = await this.resolveCashAccount(ctx, 'CAIXA-DEFAULT', line.date);
      const totalCash = Math.abs(Number(line.total_net_value ?? line.quantity * line.unit_price));
      const fees = Math.abs(
        (line.brokerage_fee ?? 0) + (line.b3_fees ?? 0) + (line.irrf_tax ?? 0)
      );
      if (totalCash > 0) {
        await this.financialLedger.record(ctx, {
          accountId,
          transactionDate: line.date,
          direction: cashDirection,
          amount: totalCash,
          description: line.notes ?? op,
          status: 'cleared',
          settlementDate: line.settlement_date ?? line.date,
          externalRef: ref ? `BROKER_REF:${ref}:CASH` : null,
          metadata: {
            legacy_op: op,
            broker_note_ref: ref ?? null,
            fees,
          },
        });
      }
    }

    return { skipped: false };
  }
}
