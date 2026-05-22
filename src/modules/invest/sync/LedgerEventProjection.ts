import type { CoCeoDataGateway, UserContext } from '../../../core/dal';
import { GatewayError } from '../../../core/dal/errors';
import { SYSTEM_INSTALLER_USER_ID } from '../../../core/dal/types';
import type { LedgerEvent } from '../../../core/invest/CustodyEngine';
import type { LedgerTransactionType } from '../../../core/invest/ledgerTypes';

/**
 * Reconstrói LedgerEvent[] (shape consumido por CustodyEngine,
 * threePricesEngine, PnLPivotEngine, PatrimonyMtmDailyEngine) lendo do
 * NUCLEO PATRIMONIAL CANONICO em vez do schema legado.
 *
 * Fontes:
 *   - patrimony_ledger_entries (joinado com patrimony_items + invest_position_ext)
 *   - financial_ledger_entries (joinado com financial_accounts) — eventos de
 *     caixa puro (dividendo, JCP, cash_yield, capital_deposit, pending_settlement)
 *     que historicamente ficavam em invest_ledger_entries com asset CAIXA-X.
 *
 * Estrategia de fidelidade:
 *   - O CoreModelSync grava `metadata.legacy_op` em cada projecao a partir do
 *     legado, preservando o transaction_type original ('buy'|'sell'|'put_sell'|
 *     'option_exercise'|...). Aqui re-lemos esse campo.
 *   - Quando o lancamento foi criado via InvestOperations (sem legacy_op),
 *     inferimos transaction_type a partir de movement_type + asset_class +
 *     sinal da quantidade.
 */
export class LedgerEventProjection {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  private static toIsoDate(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const y = value.getUTCFullYear();
      const m = String(value.getUTCMonth() + 1).padStart(2, '0');
      const d = String(value.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const s = String(value ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s.slice(0, 10);
  }

  private static parseMetadata(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    try {
      return JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Mapeia movement_type (núcleo) para LedgerTransactionType (legado) quando
   * não há metadata.legacy_op. Usado por lançamentos criados direto via
   * InvestOperations.
   */
  private static movementTypeToLegacy(
    movementType: string,
    assetClass: string | null,
    signedQty: number
  ): LedgerTransactionType {
    const isOption = assetClass === 'option_call' || assetClass === 'option_put';
    const optionSide: 'put' | 'call' | null = assetClass === 'option_put'
      ? 'put'
      : assetClass === 'option_call'
      ? 'call'
      : null;

    switch (movementType) {
      case 'opening_balance':
        return 'opening_balance';
      case 'split':
        return 'split';
      case 'revaluation':
        return 'revaluation';
      case 'acquisition':
        if (isOption && optionSide) return optionSide === 'put' ? 'put_buy' : 'call_buy';
        return 'buy';
      case 'disposition':
        if (isOption && optionSide) return optionSide === 'put' ? 'put_sell' : 'call_sell';
        return 'sell';
      case 'short_open':
        if (optionSide === 'put') return 'put_sell';
        if (optionSide === 'call') return 'call_sell';
        return 'sell';
      case 'short_close':
        if (optionSide === 'put') return 'put_buy';
        if (optionSide === 'call') return 'call_buy';
        return 'buy';
      case 'bonus':
        return 'bonus';
      default:
        return signedQty >= 0 ? 'buy' : 'sell';
    }
  }

  /**
   * Heuristica do "asset_type" legado a partir de subcategory do nucleo.
   */
  private static subcategoryToAssetType(subcategory: string): string {
    switch (subcategory) {
      case 'stock':
      case 'fii':
      case 'option_call':
      case 'option_put':
      case 'fixed_income':
      case 'etf':
      case 'bdr':
        return subcategory;
      default:
        return subcategory;
    }
  }

  async listLedgerEvents(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<LedgerEvent[]> {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organização obrigatória.', 400);
    }

    // Usamos installer para bypass do field policy nas tabelas internas. Os
    // dados retornados serao montados em LedgerEvent[] (uso só interno).
    const installer: UserContext = {
      userId: SYSTEM_INSTALLER_USER_ID,
      organizationId: orgId,
      impersonatorId: null,
      scope: 'global',
    };

    const items = await this.gateway.findWhere(installer, 'patrimony_items', {
      organization_id: orgId,
      source_module: 'INVEST',
    });
    const itemById = new Map<string, Record<string, unknown>>();
    for (const it of items) itemById.set(String(it.id), it);

    const positionExts = await this.gateway.findWhere(installer, 'invest_position_ext', {
      organization_id: orgId,
    });
    const extByItemId = new Map<string, Record<string, unknown>>();
    for (const ext of positionExts) extByItemId.set(String(ext.patrimony_item_id), ext);

    const accounts = await this.gateway.findWhere(installer, 'financial_accounts', {
      organization_id: orgId,
      source_module: 'INVEST',
    });
    const accountById = new Map<string, Record<string, unknown>>();
    for (const acc of accounts) accountById.set(String(acc.id), acc);

    const pl = await this.gateway.findWhere(installer, 'patrimony_ledger_entries', {
      organization_id: orgId,
    });
    const fl = await this.gateway.findWhere(installer, 'financial_ledger_entries', {
      organization_id: orgId,
    });

    const events: Array<LedgerEvent & { _sortKey: string }> = [];

    for (const row of pl) {
      const date = LedgerEventProjection.toIsoDate(row.transaction_date);
      if (date < from || date > to) continue;
      const itemId = String(row.patrimony_item_id);
      const item = itemById.get(itemId);
      if (!item) continue;
      const ext = extByItemId.get(itemId);
      const subcategory = String(item.subcategory ?? '');
      const ticker = String(item.identifier ?? '').toUpperCase();
      const assetClass = ext ? String(ext.asset_class ?? subcategory) : subcategory;
      const underlying = ext?.underlying_ticker ? String(ext.underlying_ticker) : null;
      const meta = LedgerEventProjection.parseMetadata(row.metadata);
      const legacyOp = typeof meta.legacy_op === 'string' ? (meta.legacy_op as string) : null;
      const movementType = String(row.movement_type ?? '');
      const signedQty = Number(row.quantity_delta ?? 0);
      const unitPrice = Number(row.unit_value ?? 0);
      const totalValue = Number(row.total_value ?? 0);
      const impactsValuation = row.impacts_valuation == null ? null : Boolean(row.impacts_valuation);

      const txType: LedgerTransactionType = (legacyOp as LedgerTransactionType) ||
        LedgerEventProjection.movementTypeToLegacy(movementType, assetClass, signedQty);

      // Replica convencao do LegacyMirror.recordLegacyOpeningEntry:
      //   total_net_value = input.quantity * input.unitPrice (signed pelo delta)
      // O CustodyEngine antigo trata buyCost(net<0 ? -net : q*p), entao essa
      // convencao "esquisita" eh idempotente com a leitura existente.
      const totalNet = signedQty * unitPrice;

      const brokerNoteRef = typeof meta.broker_note_ref === 'string'
        ? (meta.broker_note_ref as string)
        : row.external_ref
        ? String(row.external_ref)
        : null;

      // Convencao legada: quantity sempre positiva (abs) em opening_balance;
      // o lado short eh inferido pelo asset_type (option_call/put) + sinal de
      // total_net_value. Para acquisition/disposition do legado, quantity vinha
      // signed (positivo para buy, negativo para sell). Replicamos isso.
      const legacyQty = movementType === 'opening_balance'
        ? Math.abs(signedQty)
        : signedQty;

      events.push({
        id: String(row.id),
        transaction_date: date,
        broker_note_ref: brokerNoteRef,
        notes: row.notes ? String(row.notes) : null,
        asset_id: itemId,
        asset_ticker: ticker,
        asset_type: LedgerEventProjection.subcategoryToAssetType(assetClass || subcategory),
        underlying_ticker: underlying,
        transaction_type: txType,
        quantity: legacyQty,
        unit_price: unitPrice,
        total_net_value: totalNet,
        brokerage_fee: 0,
        b3_fees: 0,
        irrf_tax: 0,
        impacts_managerial_price: impactsValuation,
        _sortKey: `${date}|${row.created_at ?? ''}|${row.id}`,
      });
    }

    for (const row of fl) {
      const date = LedgerEventProjection.toIsoDate(row.transaction_date);
      if (date < from || date > to) continue;
      const accId = String(row.account_id);
      const account = accountById.get(accId);
      if (!account) continue;
      const meta = LedgerEventProjection.parseMetadata(row.metadata);
      const legacyOp = typeof meta.legacy_op === 'string' ? (meta.legacy_op as string) : null;
      const direction = String(row.direction ?? '');
      const amount = Number(row.amount ?? 0);
      const externalId = String(account.external_id ?? 'CASH');
      const cashTicker = `CAIXA-${externalId}`.toUpperCase();
      const status = String(row.status ?? 'cleared');

      const description = row.description ? String(row.description) : '';
      const isOpeningDescription = /saldo\s+inicial/i.test(description);

      let txType: LedgerTransactionType;
      if (legacyOp) {
        txType = legacyOp as LedgerTransactionType;
      } else if (status === 'pending') {
        txType = 'pending_settlement';
      } else if (isOpeningDescription) {
        txType = 'opening_balance';
      } else if (direction === 'in') {
        txType = 'capital_deposit';
      } else {
        txType = 'capital_withdrawal';
      }

      const totalNet = direction === 'in' ? Math.abs(amount) : -Math.abs(amount);
      const brokerNoteRef = typeof meta.broker_note_ref === 'string'
        ? (meta.broker_note_ref as string)
        : row.external_ref
        ? String(row.external_ref)
        : null;

      events.push({
        id: String(row.id),
        transaction_date: date,
        broker_note_ref: brokerNoteRef,
        notes: row.description ? String(row.description) : null,
        asset_id: accId,
        asset_ticker: cashTicker,
        asset_type: 'cash',
        underlying_ticker: null,
        transaction_type: txType,
        quantity: txType === 'opening_balance' ? Math.abs(amount) : 0,
        unit_price: txType === 'opening_balance' ? 1 : 0,
        total_net_value: totalNet,
        brokerage_fee: 0,
        b3_fees: 0,
        irrf_tax: 0,
        impacts_managerial_price: false,
        _sortKey: `${date}|${row.created_at ?? ''}|${row.id}`,
      });
    }

    events.sort((a, b) => a._sortKey.localeCompare(b._sortKey));
    return events.map(({ _sortKey, ...rest }) => rest);
  }
}
