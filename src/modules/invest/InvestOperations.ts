import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, SecurePayload, UserContext } from '../../core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../../core/dal/types';
import { GatewayError } from '../../core/dal/errors';
import type { InventoryLedger, InventoryRegistry } from '../../core/inventory';
import type {
  FinancialAccountRegistry,
  FinancialLedger,
} from '../../core/financial';
import type {
  BusinessEventRegistry,
  BusinessEventKind,
  CreateBusinessEventInput,
} from '../../core/business-events';
import type {
  InvestAssetClass,
  InvestPositionExtRow,
  OpeningBatchInput,
  OpeningBatchResult,
  OpeningPositionInput,
} from './types';
import { inferAssetType, inferUnderlyingTicker } from '../../core/invest/assetClassifier';
import { inferOptionExpiryDate } from '../../core/invest/optionExpiry';
import type { LedgerImportLine } from '../../core/invest/ledgerTypes';
import {
  type DedupMatchKind,
  type IndexedLedgerOperation,
  type LedgerDedupIndex,
  importLineFeesTotal,
  lookupDuplicate,
  wouldDoubleCash,
} from '../../core/invest/ledgerOperationDedup';
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
    private readonly financialLedger: FinancialLedger,
    /**
     * Registry do header canonico (business_events). Opcional pra nao quebrar
     * callers legados, mas todo write novo deveria ja passar.
     */
    private readonly businessEvents?: BusinessEventRegistry
  ) {}

  /**
   * Mapeia operacao de import (LedgerTransactionType) para event_kind canonico.
   */
  private static kindOf(op: string): BusinessEventKind {
    if (op === 'opening_balance') return 'opening_balance';
    if (op === 'buy' || op === 'sell' || op === 'pending_settlement') return 'broker_note_spot';
    if (op === 'put_sell' || op === 'put_buy' || op === 'call_sell' || op === 'call_buy' || op === 'option_exercise') {
      return 'broker_note_option';
    }
    if (op === 'split' || op === 'bonus' || op === 'revaluation') return 'corporate_action';
    if (op === 'securities_lending') return 'broker_note_loan';
    // dividend, jcp, cash_yield, fee, penalty_b3, capital_*, cost_adjustment
    return 'cash_movement';
  }

  /**
   * Resolve qual business_event vincular a linha:
   *   1. Se a linha ja traz business_event_id, usa direto (caller ja resolveu).
   *   2. Senao, se traz event_source_ref, faz ensureByRef — multiplas linhas
   *      com o mesmo event_source_ref caem no mesmo header (1 header por nota).
   *   3. Senao, cria 1 header avulso por linha (caso classico do extrato
   *      bancario, onde cada linha eh um fato independente: multa, taxa, TED).
   * Sem registry injetado, retorna null e a linha grava sem business_event_id
   * (compatibilidade com callers antigos).
   *
   * IMPORTANTE: broker_note_ref NAO eh chave de header — eh chave de
   * idempotencia da perna individual (vira external_ref='BROKER_REF:{ref}').
   * Ver docs/architecture/business_events_integration_plan.md.
   */
  private async resolveOrCreateEvent(
    ctx: UserContext,
    line: LedgerImportLine
  ): Promise<string | null> {
    if (!this.businessEvents) return null;
    if (line.business_event_id) return line.business_event_id;
    const kind = InvestOperations.kindOf(String(line.operation));
    const net = Number(line.total_net_value ?? line.quantity * line.unit_price);
    if (line.event_source_ref) {
      const { event } = await this.businessEvents.ensureByRef(ctx, {
        sourceModule: 'INVEST',
        eventKind: kind,
        occurredOn: line.date,
        settlesOn: line.settlement_date ?? line.date,
        sourceRef: line.event_source_ref,
        counterparty: line.counterparty ?? null,
        totalNet: net,
        sourceSystem: line.source_system ?? 'invest_operations',
        sourceVersion: line.source_version ?? null,
      });
      return event.id;
    }
    const ev = await this.businessEvents.create(ctx, {
      sourceModule: 'INVEST',
      eventKind: kind,
      occurredOn: line.date,
      settlesOn: line.settlement_date ?? line.date,
      sourceRef: null,
      counterparty: line.counterparty ?? null,
      totalNet: net,
      sourceSystem: line.source_system ?? 'invest_operations',
      sourceVersion: line.source_version ?? null,
    });
    return ev.id;
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
    options: { legacyBatchId?: string; businessEventId?: string | null } = {}
  ): Promise<{ itemId: string; entryId: string }> {
    const isOption = input.assetClass === 'option_call' || input.assetClass === 'option_put';
    if (isOption && !input.optionUnderlying) {
      throw new GatewayError(
        'INVALID_PAYLOAD',
        `Opcao ${input.ticker} exige underlying (ticker da acao mae).`,
        400
      );
    }

    const { item } = await this.inventoryRegistry.ensure(ctx, {
      category: 'financial_asset',
      subcategory: InvestOperations.subcategoryOf(input.assetClass),
      identifier: input.ticker,
      name: input.name ?? input.ticker,
    });

    const brokerRef = input.brokerNoteRef?.trim();
    const { entry, state } = await this.inventoryLedger.recordMovement(ctx, {
      itemId: item.id,
      transactionDate: asOfDate,
      movementType: 'opening_balance',
      quantityDelta: input.quantity,
      unitValue: input.unitPrice,
      notes: input.notes ?? 'Saldo inicial',
      businessEventId: options.businessEventId ?? null,
      externalRef: brokerRef ? `BROKER_REF:${brokerRef}` : null,
      metadata: {
        legacy_op: 'opening_balance',
        broker_note_ref: brokerRef ?? null,
        underlying_ticker: input.optionUnderlying ?? null,
        option_strike: input.optionStrike ?? null,
        option_expiration: input.optionExpiration ?? null,
      },
    });

    await this.upsertPositionExt(ctx, item.id, input.assetClass, {
      underlying_ticker: input.optionUnderlying ?? null,
      pm_estrito: state.pmA,
      pm_b3: state.pmB,
      pm_gerencial: state.pmC,
    });

    // invest_option_ext so eh preenchido se strike + expiration vierem
    // explicitos. Opcao herdada (opening short) pode entrar sem esses
    // metadados — a Calendar/B3 popula depois via cron de cotacao.
    if (isOption && input.optionStrike) {
      const exp =
        input.optionExpiration?.slice(0, 10) ||
        inferOptionExpiryDate(input.ticker, Number(asOfDate.slice(0, 4)));
      await this.upsertOptionExt(ctx, item.id, {
        optionType:
          input.optionType ||
          (input.assetClass === 'option_call' ? 'CALL' : 'PUT'),
        underlyingTicker: input.optionUnderlying!,
        strikePrice: input.optionStrike,
        expirationDate: exp,
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
      businessEventId?: string | null;
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
      businessEventId: input.businessEventId ?? null,
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
    // Header canonico unico: TODAS as pernas do opening apontam pra ele.
    let openingEventId: string | null = null;
    if (this.businessEvents) {
      const { event } = await this.businessEvents.ensureByRef(ctx, {
        sourceModule: 'INVEST',
        eventKind: 'opening_balance',
        occurredOn: input.asOfDate,
        settlesOn: input.asOfDate,
        sourceRef: `OPENING:${input.asOfDate}`,
        counterparty: 'Saldo inicial',
        sourceSystem: 'invest_operations.opening_batch',
      });
      openingEventId = event.id;
    }
    for (const p of input.positions) {
      const before = await this.inventoryRegistry.findByIdentifier(
        ctx,
        'INVEST',
        p.ticker
      );
      const { entryId } = await this.recordOpeningPosition(ctx, input.asOfDate, p, {
        legacyBatchId,
        businessEventId: openingEventId,
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
        businessEventId: openingEventId,
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
  private installerCtx(organizationId: string): UserContext {
    return {
      userId: SYSTEM_INSTALLER_USER_ID,
      organizationId,
      impersonatorId: null,
      scope: 'global',
    };
  }

  private static parseRowMetadata(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    try {
      return JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

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
    if (fin.length) return true;
    const finCash = await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      { external_ref: `BROKER_REF:${ref}:CASH` },
      { limit: 1 }
    );
    return finCash.length > 0;
  }

  /**
   * Completa metadata de taxas em lançamento já existente (mesma nota ou mesma
   * operação). Não cria segunda perna de caixa.
   */
  private async enrichExistingFromImportLine(
    ctx: UserContext,
    existing: IndexedLedgerOperation,
    line: LedgerImportLine,
    incomingRef: string | null
  ): Promise<boolean> {
    const orgId = ctx.organizationId;
    if (!orgId) return false;
    const incomingFees = importLineFeesTotal(line);
    if (incomingFees <= 0) return false;

    const ref = existing.brokerNoteRef;
    if (!ref) return false;

    const ic = this.installerCtx(orgId);
    let changed = false;

    const patRows = await this.gateway.findWhere(
      ic,
      'patrimony_ledger_entries',
      { external_ref: `BROKER_REF:${ref}` },
      { limit: 1 }
    );
    if (patRows[0]) {
      const meta = InvestOperations.parseRowMetadata(patRows[0].metadata);
      const cur =
        Math.abs(Number(meta.brokerage_fee ?? 0)) +
        Math.abs(Number(meta.b3_fees ?? 0)) +
        Math.abs(Number(meta.irrf_tax ?? 0));
      if (incomingFees > cur + 0.001) {
        const alt = Array.isArray(meta.alternate_broker_note_refs)
          ? [...(meta.alternate_broker_note_refs as string[])]
          : [];
        if (incomingRef && incomingRef !== ref && !alt.includes(incomingRef)) {
          alt.push(incomingRef);
        }
        await this.gateway.update(ic, 'patrimony_ledger_entries', String(patRows[0].id), {
          metadata: {
            ...meta,
            brokerage_fee: line.brokerage_fee ?? meta.brokerage_fee ?? 0,
            b3_fees: line.b3_fees ?? meta.b3_fees ?? 0,
            irrf_tax: line.irrf_tax ?? meta.irrf_tax ?? 0,
            alternate_broker_note_refs: alt.length ? alt : undefined,
          },
        });
        changed = true;
      }
    }

    const cashRows = await this.gateway.findWhere(
      ic,
      'financial_ledger_entries',
      { external_ref: `BROKER_REF:${ref}:CASH` },
      { limit: 1 }
    );
    if (cashRows[0]) {
      const meta = InvestOperations.parseRowMetadata(cashRows[0].metadata);
      const cur = Math.abs(Number(meta.fees ?? 0)) || importLineFeesTotal({
        ...line,
        brokerage_fee: Number(meta.brokerage_fee ?? 0),
        b3_fees: Number(meta.b3_fees ?? 0),
        irrf_tax: Number(meta.irrf_tax ?? 0),
      });
      if (incomingFees > cur + 0.001) {
        await this.gateway.update(ic, 'financial_ledger_entries', String(cashRows[0].id), {
          metadata: {
            ...meta,
            fees: incomingFees,
            brokerage_fee: line.brokerage_fee ?? 0,
            b3_fees: line.b3_fees ?? 0,
            irrf_tax: line.irrf_tax ?? 0,
          },
        });
        changed = true;
      }
    }

    return changed;
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
    line: LedgerImportLine,
    options?: { dedupIndex?: LedgerDedupIndex }
  ): Promise<{
    skipped: boolean;
    reason?: string;
    enriched?: boolean;
    match?: DedupMatchKind;
  }> {
    const op = String(line.operation);
    const ticker = String(line.ticker || '').toUpperCase().trim();
    if (!ticker) {
      return { skipped: true, reason: 'ticker vazio' };
    }
    const ref = line.broker_note_ref?.trim();
    if (ref && (await this.hasExistingByRef(ctx, ref))) {
      const enriched = await this.enrichExistingFromImportLine(
        ctx,
        {
          brokerNoteRef: ref,
          bareNoteNumber: null,
          fingerprint: '',
          date: line.date,
          ticker,
          assetType: line.asset_type || inferAssetType(ticker),
          operation: op,
          quantity: Math.abs(line.quantity),
          unitPrice: line.unit_price,
          cashAmount: null,
          feesTotal: 0,
        },
        line,
        ref
      );
      return {
        skipped: true,
        reason: `broker_note_ref ${ref} ja registrado`,
        enriched,
        match: 'broker_note_ref',
      };
    }

    if (options?.dedupIndex) {
      const dup = lookupDuplicate(options.dedupIndex, line);
      if (dup) {
        const enriched = await this.enrichExistingFromImportLine(
          ctx,
          dup.existing,
          line,
          ref || null
        );
        const doubleCash = wouldDoubleCash(dup.existing, line);
        const sib = dup.fingerprintSiblings.length > 1 ? '; multiplas pernas no livro' : '';
        return {
          skipped: true,
          reason: `duplicata (${dup.match})${doubleCash ? '; caixa ja registrado' : ''}${sib}`,
          enriched,
          match: dup.match,
        };
      }
    }

    const declaredType = String(line.asset_type ?? '').trim();
    const assetType = declaredType || inferAssetType(ticker);
    const isCash = assetType === 'cash' || ticker.startsWith('CAIXA-');
    const businessEventId = await this.resolveOrCreateEvent(ctx, line);

    // Opening_balance vai pelo caminho dedicado. Repassa businessEventId pra
    // garantir rastreabilidade no header OPENING:{date}.
    if (op === 'opening_balance') {
      if (isCash) {
        await this.recordOpeningCash(ctx, line.date, {
          brokerCode: InvestOperations.cashTickerToExternalId(ticker) ?? 'CASH',
          externalId: InvestOperations.cashTickerToExternalId(ticker) ?? 'CASH',
          balance: Number(line.unit_price || line.total_net_value || 0) * (Number(line.quantity) || 1),
          businessEventId,
        });
        return { skipped: false };
      }
      const cls = (assetType as InvestAssetClass);
      const und = inferUnderlyingTicker(ticker, line.underlying_ticker) ?? undefined;
      await this.recordOpeningPosition(
        ctx,
        line.date,
        {
          ticker,
          assetClass: cls,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unit_price),
          optionUnderlying: und,
          optionStrike: line.option_strike,
          optionExpiration:
            line.option_expiration?.slice(0, 10) ||
            (cls === 'option_call' || cls === 'option_put'
              ? inferOptionExpiryDate(ticker)
              : undefined),
          optionType:
            cls === 'option_call' ? 'CALL' : cls === 'option_put' ? 'PUT' : undefined,
          notes: line.notes,
          brokerNoteRef: ref,
        },
        { businessEventId }
      );
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
        businessEventId,
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
        businessEventId,
        externalRef: ref ? `BROKER_REF:${ref}` : null,
        metadata: { legacy_op: op, broker_note_ref: ref ?? null },
      });
      return { skipped: false };
    }

    if (op === 'cost_adjustment') {
      if (isCash) {
        return {
          skipped: true,
          reason: `cost_adjustment exige ticker patrimonial (ativo afetado), nao ${ticker}`,
        };
      }
      const assetClass = assetType as InvestAssetClass;
      const { item } = await this.inventoryRegistry.ensure(ctx, {
        category: 'financial_asset',
        subcategory: InvestOperations.subcategoryOf(assetClass),
        identifier: ticker,
        name: ticker,
      });
      // Custo absoluto vem ou em unit_price (linha simples) ou em total_net_value.
      const amount = Math.abs(
        Number(line.total_net_value ?? line.unit_price ?? 0)
      );
      if (amount === 0) return { skipped: true, reason: 'cost_adjustment com custo zero' };

      await this.inventoryLedger.recordMovement(ctx, {
        itemId: item.id,
        transactionDate: line.date,
        movementType: 'cost_adjustment',
        quantityDelta: 0,
        unitValue: amount,
        notes: line.notes ?? op,
        externalRef: ref ? `BROKER_REF:${ref}` : undefined,
        businessEventId,
        metadata: {
          legacy_op: 'fee',
          broker_note_ref: ref ?? null,
          applies_to_b3: line.applies_to_b3 ?? false,
          target_ticker: ticker,
        },
      });

      const { accountId } = await this.resolveCashAccount(ctx, 'CAIXA-DEFAULT', line.date);
      await this.financialLedger.record(ctx, {
        accountId,
        transactionDate: line.date,
        direction: 'out',
        amount,
        description: line.notes ?? `cost_adjustment ${ticker}`,
        status: 'cleared',
        settlementDate: line.settlement_date ?? line.date,
        businessEventId,
        externalRef: ref ? `BROKER_REF:${ref}:CASH` : null,
        metadata: {
          legacy_op: 'fee',
          broker_note_ref: ref ?? null,
          target_ticker: ticker,
        },
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
        businessEventId,
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
      | 'revaluation';
    let quantityDelta: number;
    let cashDirection: 'in' | 'out' | null = null;

    if (TRADE_OPS.has(op)) {
      movementType = op === 'buy' ? 'acquisition' : 'disposition';
      quantityDelta = op === 'buy' ? Math.abs(line.quantity) : -Math.abs(line.quantity);
      cashDirection = op === 'buy' ? 'out' : 'in';
    } else if (OPTION_OPS.has(op)) {
      // Toda venda (put_sell/call_sell) eh disposition. Toda compra
      // (put_buy/call_buy) eh acquisition. O estado de "short" e derivado
      // pela quantidade resultante (qty < 0 = posicao vendida liquida).
      if (op === 'put_sell' || op === 'call_sell') {
        movementType = 'disposition';
        quantityDelta = -Math.abs(line.quantity);
        cashDirection = 'in';
      } else {
        movementType = 'acquisition';
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
      businessEventId,
      metadata: {
        legacy_op: op,
        broker_note_ref: ref ?? null,
        ...(line.option_strike != null && line.option_strike > 0
          ? { option_strike: line.option_strike }
          : {}),
        ...((line.brokerage_fee ?? 0) + (line.b3_fees ?? 0) + (line.irrf_tax ?? 0) > 0
          ? {
              brokerage_fee: line.brokerage_fee ?? 0,
              b3_fees: line.b3_fees ?? 0,
              irrf_tax: line.irrf_tax ?? 0,
            }
          : {}),
      },
    });

    const isOptionTrade =
      assetClass === 'option_call' || assetClass === 'option_put' || OPTION_OPS.has(op);
    if (isOptionTrade && line.option_strike != null && line.option_strike > 0) {
      const und = inferUnderlyingTicker(ticker, line.underlying_ticker);
      if (und) {
        await this.upsertOptionExt(ctx, item.id, {
          optionType: assetClass === 'option_call' ? 'CALL' : 'PUT',
          underlyingTicker: und,
          strikePrice: line.option_strike,
          expirationDate: inferOptionExpiryDate(ticker),
        });
      }
    }

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
          businessEventId,
          externalRef: ref ? `BROKER_REF:${ref}:CASH` : null,
          metadata: {
            legacy_op: op,
            broker_note_ref: ref ?? null,
            fees,
            brokerage_fee: line.brokerage_fee ?? 0,
            b3_fees: line.b3_fees ?? 0,
            irrf_tax: line.irrf_tax ?? 0,
          },
        });
      }
    }

    return { skipped: false };
  }

  // ==========================================================================
  // VOID / AMEND — anulacao e correcao de eventos ja gravados
  // ==========================================================================

  /**
   * Soft-deleta TODAS as pernas (custodia + caixa) vinculadas a um header.
   * Retorna os patrimony_item_ids tocados (caller usa pra rebuild).
   *
   * Privado: nao chame direto; use voidEvent/amendEvent que fazem o ciclo
   * completo (header + pernas + rebuild).
   */
  private async invalidateLegs(
    ctx: UserContext,
    eventId: string
  ): Promise<{ patrimonyItemIds: Set<string>; voidedPatrimony: number; voidedFinancial: number }> {
    if (!this.businessEvents) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'InvestOperations construido sem BusinessEventRegistry; void/amend indisponivel.',
        500
      );
    }
    const { patrimonyLegs, financialLegs } = await this.businessEvents.listLegs(
      ctx,
      eventId
    );
    const itemIds = new Set<string>();
    for (const leg of patrimonyLegs) {
      const id = String((leg as { id: string }).id);
      const itemId = String((leg as { patrimony_item_id: string }).patrimony_item_id);
      itemIds.add(itemId);
      await this.gateway.softDelete(ctx, 'patrimony_ledger_entries', id);
    }
    for (const leg of financialLegs) {
      const id = String((leg as { id: string }).id);
      await this.gateway.softDelete(ctx, 'financial_ledger_entries', id);
    }
    return {
      patrimonyItemIds: itemIds,
      voidedPatrimony: patrimonyLegs.length,
      voidedFinancial: financialLegs.length,
    };
  }

  /**
   * Estorno explicito: marca o header como voided e soft-deleta as pernas.
   * Apos o void, o saldo dos itens afetados eh recomputado via rebuild.
   *
   * Use quando o evento de negocio foi cancelado (B3 cancelou retroativamente,
   * cliente desistiu, etc). Audit trail fica em:
   *   - business_events.voided_at / voided_by_user_id / void_reason
   *   - audit_logs (do gateway) com SOFT_DELETE de cada perna
   */
  async voidEvent(
    ctx: UserContext,
    eventId: string,
    reason: string
  ): Promise<{
    voidedPatrimonyLegs: number;
    voidedFinancialLegs: number;
    rebuiltItems: number;
  }> {
    if (!this.businessEvents) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'InvestOperations construido sem BusinessEventRegistry; void indisponivel.',
        500
      );
    }
    const event = await this.businessEvents.findById(ctx, eventId);
    if (!event) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `business_events ${eventId} nao encontrado`,
        404
      );
    }
    if (event.voided_at) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        `business_events ${eventId} ja esta voided em ${event.voided_at}`,
        409
      );
    }
    await this.businessEvents.voidEvent(ctx, eventId, ctx.userId, reason);
    const { patrimonyItemIds, voidedPatrimony, voidedFinancial } =
      await this.invalidateLegs(ctx, eventId);
    for (const itemId of patrimonyItemIds) {
      await this.inventoryLedger.rebuildAndPersist(ctx, itemId);
    }
    return {
      voidedPatrimonyLegs: voidedPatrimony,
      voidedFinancialLegs: voidedFinancial,
      rebuiltItems: patrimonyItemIds.size,
    };
  }

  /**
   * Correcao com nova revisao: cria business_events rev=N+1 supersedendo a
   * anterior, soft-deleta pernas antigas e re-grava as N pernas novas.
   *
   * - `headerPatch`: campos do novo header (occurred_on, total_net, etc).
   *   Default copia da revisao anterior.
   * - `lines`: as novas linhas a reaplicar via recordOperation. Cada linha
   *   herda automaticamente o business_event_id da nova revisao.
   *
   * Apos o amend, todos os patrimony_items afetados (pelas pernas antigas E
   * pelas novas) tem seu snapshot recomputado.
   */
  async amendEvent(
    ctx: UserContext,
    prevEventId: string,
    headerPatch: Partial<CreateBusinessEventInput>,
    lines: LedgerImportLine[]
  ): Promise<{
    newEventId: string;
    revisionNo: number;
    voidedPatrimonyLegs: number;
    voidedFinancialLegs: number;
    recreatedLines: number;
    skippedLines: number;
    rebuiltItems: number;
  }> {
    if (!this.businessEvents) {
      throw new GatewayError(
        'INVALID_CONTEXT',
        'InvestOperations construido sem BusinessEventRegistry; amend indisponivel.',
        500
      );
    }
    const prev = await this.businessEvents.findById(ctx, prevEventId);
    if (!prev) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `business_events ${prevEventId} nao encontrado`,
        404
      );
    }
    if (prev.voided_at) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        `Nao se faz amend de header voided (${prevEventId}). Crie um novo header.`,
        409
      );
    }
    const newHeaderInput: CreateBusinessEventInput = {
      sourceModule: headerPatch.sourceModule ?? prev.source_module,
      eventKind: headerPatch.eventKind ?? prev.event_kind,
      occurredOn: headerPatch.occurredOn ?? prev.occurred_on,
      settlesOn: headerPatch.settlesOn ?? prev.settles_on,
      sourceRef: headerPatch.sourceRef ?? prev.source_ref,
      counterparty: headerPatch.counterparty ?? prev.counterparty,
      totalGross: headerPatch.totalGross ?? Number(prev.total_gross),
      totalCosts: headerPatch.totalCosts ?? Number(prev.total_costs),
      totalNet: headerPatch.totalNet ?? Number(prev.total_net),
      sourceSystem: headerPatch.sourceSystem ?? prev.source_system,
      sourceVersion: headerPatch.sourceVersion ?? prev.source_version,
      recordedByUserId: headerPatch.recordedByUserId ?? ctx.userId,
      metadata: headerPatch.metadata ?? null,
    };
    const newEvent = await this.businessEvents.amend(ctx, prevEventId, newHeaderInput);

    const { patrimonyItemIds, voidedPatrimony, voidedFinancial } =
      await this.invalidateLegs(ctx, prevEventId);

    let recreated = 0;
    let skipped = 0;
    for (const line of lines) {
      const result = await this.recordOperation(ctx, {
        ...line,
        business_event_id: newEvent.id,
      });
      if (result.skipped) skipped += 1;
      else recreated += 1;
    }

    // Recolhe items tocados pelas linhas novas (alem dos antigos).
    const newLegs = await this.businessEvents.listLegs(ctx, newEvent.id);
    for (const leg of newLegs.patrimonyLegs) {
      patrimonyItemIds.add(String((leg as { patrimony_item_id: string }).patrimony_item_id));
    }

    for (const itemId of patrimonyItemIds) {
      await this.inventoryLedger.rebuildAndPersist(ctx, itemId);
    }

    return {
      newEventId: newEvent.id,
      revisionNo: newEvent.revision_no,
      voidedPatrimonyLegs: voidedPatrimony,
      voidedFinancialLegs: voidedFinancial,
      recreatedLines: recreated,
      skippedLines: skipped,
      rebuiltItems: patrimonyItemIds.size,
    };
  }
}
