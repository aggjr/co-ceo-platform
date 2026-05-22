import { randomUUID } from 'crypto';
import { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { inferAssetType } from './assetClassifier';
import { rebuildCustodyFromLedger, type LedgerEvent } from './CustodyEngine';
import {
  canonicalTesouroTicker,
  normalizeLedgerLineQuantity,
} from './tesouroDirectLedger';
import {
  LEDGER_TRANSACTION_TYPES,
  type LedgerImportPayload,
  type OpeningImportPayload,
} from './ledgerTypes';
import { LedgerEventProjection } from '../../modules/invest/sync/LedgerEventProjection';
import {
  buildInvestOperations,
  type InvestOperations,
} from '../../modules/invest';
import { syncAutoPendingSettlements } from './AutoPendingSettlementSync';

/** Abertura de custódia — referência única usada para idempotência. */
const OPENING_BATCH_REF = 'OPENING-BTG-2026-01-01';

function parseDate(value: string): string {
  const d = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new GatewayError('INVALID_PAYLOAD', `Data inválida: ${value}`, 400);
  }
  return d;
}

export class LedgerImportService {
  private readonly projection: LedgerEventProjection;
  private readonly operations: InvestOperations;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.projection = new LedgerEventProjection(gateway);
    this.operations = buildInvestOperations(gateway);
  }

  async importPortfolio(ctx: UserContext, payload: LedgerImportPayload) {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organização obrigatória para importar.', 400);
    }

    const openingDate = parseDate(payload.opening_date);
    const batchId = randomUUID();
    let inserted = 0;

    // 1. Posicoes de abertura → opening_balance no nucleo (InvestOperations).
    for (const pos of payload.opening_positions || []) {
      const ticker = canonicalTesouroTicker(pos.ticker.trim().toUpperCase());
      const assetType = pos.asset_type || inferAssetType(ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: pos.quantity,
        unit_price: pos.avg_price,
      });
      const line: LedgerImportPayload['entries'][number] = {
        date: openingDate,
        ticker,
        operation: 'opening_balance',
        quantity: norm.quantity,
        unit_price: norm.unit_price,
        underlying_ticker: pos.underlying_ticker,
        asset_type: assetType,
        notes: payload.source_label
          ? `Saldo inicial — ${payload.source_label}`
          : pos.notes ?? 'Saldo inicial da carteira',
        option_strike: pos.option_strike,
        broker_note_ref: `OPEN:${batchId}:${ticker}`,
      };
      const result = await this.operations.recordOperation(ctx, line);
      if (!result.skipped) inserted += 1;
    }

    // 2. Shorts de abertura (PUT/CALL vendida) → short_open com qty negativa.
    for (const short of payload.opening_short_options || []) {
      const ticker = short.ticker.trim().toUpperCase();
      const op = short.operation; // put_sell | call_sell
      const assetType = inferAssetType(ticker);
      const line: LedgerImportPayload['entries'][number] = {
        date: openingDate,
        ticker,
        operation: op,
        quantity: Math.abs(short.quantity),
        unit_price: short.unit_price,
        underlying_ticker: short.underlying_ticker,
        asset_type: assetType,
        notes: short.notes ?? `Saldo inicial (short)`,
        broker_note_ref: `OPEN-SHORT:${batchId}:${ticker}`,
      };
      const result = await this.operations.recordOperation(ctx, line);
      if (!result.skipped) inserted += 1;
    }

    // 3. Lancamentos regulares (notas, extratos mensais).
    const statementEntries =
      payload.monthly_statements?.flatMap((st) =>
        (st.entries || []).map((e) => ({
          ...e,
          notes: e.notes || `Extrato ${st.month}${st.broker ? ` — ${st.broker}` : ''}`,
        }))
      ) ?? [];
    const allLines = [...(payload.entries || []), ...statementEntries];

    for (const line of allLines) {
      const op = String(line.operation);
      if (!LEDGER_TRANSACTION_TYPES.includes(op as (typeof LEDGER_TRANSACTION_TYPES)[number])) {
        throw new GatewayError('INVALID_PAYLOAD', `Operação não suportada: ${op}`, 400);
      }
      const ticker = canonicalTesouroTicker(line.ticker.trim().toUpperCase());
      const assetType = line.asset_type || inferAssetType(ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: line.quantity,
        unit_price: line.unit_price,
      });
      const result = await this.operations.recordOperation(ctx, {
        ...line,
        ticker,
        asset_type: assetType,
        quantity: norm.quantity,
        unit_price: norm.unit_price,
        date: parseDate(line.date),
      });
      if (!result.skipped) inserted += 1;
    }

    const pendingSync = await this.syncAutoPendingSettlements(ctx);
    return {
      batchId,
      inserted,
      openingDate,
      pendingSync,
    };
  }

  /**
   * Insere apenas saldos de abertura (ações, RF, shorts) sem repetir caixa/extratos já importados.
   */
  async importOpeningOnly(ctx: UserContext, payload: OpeningImportPayload) {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organização obrigatória para importar.', 400);
    }

    const openingDate = parseDate(payload.opening_date);
    const batchId = randomUUID();
    let inserted = 0;
    let skipped = 0;

    const notePrefix = payload.source_label
      ? `Saldo inicial — ${payload.source_label}`
      : 'Saldo inicial da carteira';

    for (const pos of payload.opening_positions || []) {
      const ticker = canonicalTesouroTicker(pos.ticker.trim().toUpperCase());
      const assetType = pos.asset_type || inferAssetType(ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: pos.quantity,
        unit_price: pos.avg_price,
      });
      const result = await this.operations.recordOperation(ctx, {
        date: openingDate,
        ticker,
        operation: 'opening_balance',
        quantity: norm.quantity,
        unit_price: norm.unit_price,
        underlying_ticker: pos.underlying_ticker,
        asset_type: assetType,
        notes: pos.notes ? `${notePrefix} — ${pos.notes}` : notePrefix,
        option_strike: pos.option_strike,
        broker_note_ref: `${OPENING_BATCH_REF}:${ticker}`,
      });
      if (result.skipped) skipped += 1;
      else inserted += 1;
    }

    for (const line of payload.opening_short_options || []) {
      const ticker = line.ticker.trim().toUpperCase();
      const op = line.operation;
      const result = await this.operations.recordOperation(ctx, {
        date: openingDate,
        ticker,
        operation: op,
        quantity: Math.abs(Number(line.quantity)),
        unit_price: Number(line.unit_price),
        underlying_ticker: line.underlying_ticker,
        asset_type: inferAssetType(ticker),
        notes: line.notes ? `${notePrefix} — ${line.notes}` : `${notePrefix} (short)`,
        broker_note_ref: `${OPENING_BATCH_REF}:${ticker}`,
      });
      if (result.skipped) skipped += 1;
      else inserted += 1;
    }

    return { batchId, inserted, skipped, openingDate };
  }

  /**
   * Importa lançamentos (notas / myProfit) sem repetir `broker_note_ref` já existentes.
   */
  async importEntriesOnly(
    ctx: UserContext,
    entries: LedgerImportPayload['entries'],
    meta?: { sourceLabel?: string }
  ) {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organização obrigatória para importar.', 400);
    }

    const batchId = randomUUID();
    let inserted = 0;
    let skipped = 0;

    for (const line of entries || []) {
      const op = String(line.operation);
      if (!LEDGER_TRANSACTION_TYPES.includes(op as (typeof LEDGER_TRANSACTION_TYPES)[number])) {
        throw new GatewayError('INVALID_PAYLOAD', `Operação não suportada: ${op}`, 400);
      }

      const ticker = canonicalTesouroTicker(line.ticker.trim().toUpperCase());
      const assetType = line.asset_type || inferAssetType(ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: line.quantity,
        unit_price: line.unit_price,
      });
      const result = await this.operations.recordOperation(ctx, {
        ...line,
        ticker,
        asset_type: assetType,
        quantity: norm.quantity,
        unit_price: norm.unit_price,
        date: parseDate(line.date),
        notes: line.notes
          ? meta?.sourceLabel
            ? `${line.notes} (${meta.sourceLabel})`
            : line.notes
          : meta?.sourceLabel || undefined,
      });
      if (result.skipped) skipped += 1;
      else inserted += 1;
    }

    return { batchId, inserted, skipped };
  }

  /**
   * Cria `pending_settlement` automaticos (D+2) para patrimonio bater com a
   * conta de caixa. Grava direto em financial_ledger_entries com status='pending'.
   */
  async syncAutoPendingSettlements(ctx: UserContext) {
    const events = await this.listLedgerEvents(ctx, '2000-01-01', new Date().toISOString().slice(0, 10));
    return syncAutoPendingSettlements(this.gateway, ctx, events, {
      operations: this.operations,
    });
  }

  /**
   * Fonte unica de leitura para os engines (CustodyEngine, threePricesEngine,
   * PnLPivotEngine, PatrimonyMtmDailyEngine). Le do nucleo patrimonial via
   * LedgerEventProjection.
   */
  async listLedgerEvents(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<LedgerEvent[]> {
    return this.projection.listLedgerEvents(ctx, from, to);
  }

  /**
   * Re-deriva quantidades e PM no nucleo. O InventoryLedger ja atualiza
   * patrimony_items.quantity/current_value a cada movimento, entao isto eh
   * apenas um "tocar" idempotente. Mantido por compatibilidade com chamadas
   * antigas; pode ser removido quando os callers forem auditados.
   */
  async reconcileCustody(ctx: UserContext) {
    const from = '2000-01-01';
    const to = new Date().toISOString().slice(0, 10);
    const events = await this.listLedgerEvents(ctx, from, to);
    const { assets, processedEntries } = rebuildCustodyFromLedger(events);
    const pendingSync = await this.syncAutoPendingSettlements(ctx);
    return { processedEntries, positions: assets.length, pendingSync };
  }
}
