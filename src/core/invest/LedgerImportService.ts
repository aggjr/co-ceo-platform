import { randomUUID } from 'crypto';
import { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
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

/** Abertura de custódia — fonte BTG/Necton (não myProfit). */
const OPENING_BATCH_REF = 'OPENING-BTG-2026-01-01';
const LEGACY_OPENING_BATCH_REF = 'OPENING-MYPROFIT-2025-12-31';
import { syncAutoPendingSettlements } from './AutoPendingSettlementSync';

function normalizeLedgerDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

function parseDate(value: string): string {
  const d = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new GatewayError('INVALID_PAYLOAD', `Data inválida: ${value}`, 400);
  }
  return d;
}

function signedQuantity(operation: string, quantity: number): number {
  const q = Math.abs(Number(quantity));
  if (['sell', 'put_sell', 'call_sell', 'option_exercise'].includes(operation)) return -q;
  if (
    ['buy', 'put_buy', 'call_buy', 'opening_balance', 'bonus'].includes(operation)
  ) {
    return q;
  }
  return Number(quantity);
}

function computeNet(line: {
  quantity: number;
  unit_price: number;
  brokerage_fee?: number;
  b3_fees?: number;
  irrf_tax?: number;
  total_net_value?: number;
}): number {
  if (line.total_net_value != null && !Number.isNaN(Number(line.total_net_value))) {
    return Number(line.total_net_value);
  }
  const gross = Number(line.quantity) * Number(line.unit_price);
  const fees =
    Math.abs(Number(line.brokerage_fee ?? 0)) +
    Math.abs(Number(line.b3_fees ?? 0)) +
    Math.abs(Number(line.irrf_tax ?? 0));
  return gross - fees;
}

function parseAssetMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  } catch {
    return {};
  }
}

async function persistOptionStrikeOnAsset(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  assetId: string,
  strike: number,
  asOf?: string
): Promise<void> {
  if (!Number.isFinite(strike) || strike <= 0) return;
  const rows = await gateway.findWhere(
    ctx,
    'invest_assets',
    { id: assetId },
    { limit: 1 }
  );
  const row = rows[0];
  if (!row?.id) return;
  const meta = parseAssetMetadata(row.metadata);
  meta.option_strike = Math.round(strike * 10000) / 10000;
  if (asOf) meta.option_strike_as_of = asOf.slice(0, 10);
  await gateway.update(ctx, 'invest_assets', assetId, {
    metadata: JSON.stringify(meta),
  });
}

async function ensureAsset(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  orgId: string,
  ticker: string,
  assetType: string,
  cache: Map<string, string>
): Promise<string> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;

  const existing = await gateway.findWhere(
    ctx,
    'invest_assets',
    { organization_id: orgId, asset_ticker: key },
    { limit: 1, columns: ['id'] }
  );
  if (existing[0]?.id) {
    const id = String(existing[0].id);
    cache.set(key, id);
    return id;
  }

  const id = randomUUID();
  await gateway.insert(ctx, 'invest_assets', {
    id,
    organization_id: orgId,
    asset_ticker: key,
    asset_type: assetType,
    current_quantity: 0,
    managerial_avg_price: 0,
    status: 'active',
  });
  cache.set(key, id);
  return id;
}

export class LedgerImportService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async importPortfolio(ctx: UserContext, payload: LedgerImportPayload) {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organização obrigatória para importar.', 400);
    }

    const openingDate = parseDate(payload.opening_date);
    const batchId = randomUUID();
    const assetCache = new Map<string, string>();
    let inserted = 0;

    for (const pos of payload.opening_positions || []) {
      const ticker = canonicalTesouroTicker(pos.ticker.trim().toUpperCase());
      const assetType = pos.asset_type || inferAssetType(ticker);
      const assetId = await ensureAsset(this.gateway, ctx, orgId, ticker, assetType, assetCache);
      const underlying = inferUnderlyingTicker(ticker, pos.underlying_ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: pos.quantity,
        unit_price: pos.avg_price,
        date: openingDate,
      });
      const qty = Math.abs(norm.quantity);
      const price = norm.unit_price;
      const gross = qty * price;

      await this.gateway.insert(ctx, 'invest_ledger_entries', {
        id: randomUUID(),
        organization_id: orgId,
        asset_id: assetId,
        underlying_ticker: underlying,
        transaction_date: openingDate,
        transaction_type: 'opening_balance',
        quantity: qty,
        unit_price: price,
        total_gross_value: gross,
        brokerage_fee: 0,
        b3_fees: 0,
        irrf_tax: 0,
        total_net_value: -gross,
        impacts_managerial_price: true,
        broker_note_ref: null,
        source_batch_id: batchId,
        notes: payload.source_label
          ? `Saldo inicial — ${payload.source_label}`
          : 'Saldo inicial da carteira',
      });
      inserted += 1;
    }

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
      const assetId = await ensureAsset(this.gateway, ctx, orgId, ticker, assetType, assetCache);
      const underlying = inferUnderlyingTicker(ticker, line.underlying_ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: line.quantity,
        unit_price: line.unit_price,
        total_net_value: line.total_net_value,
        date: line.date,
      });
      const qty = signedQuantity(op, norm.quantity);
      const unitPrice = norm.unit_price;
      const gross = Math.abs(qty) * unitPrice;
      const net = computeNet(line);

      const isCashFlow = [
        'capital_deposit',
        'capital_withdrawal',
        'cash_yield',
        'penalty_b3',
        'fee',
        'pending_settlement',
      ].includes(op);

      await this.gateway.insert(ctx, 'invest_ledger_entries', {
        id: randomUUID(),
        organization_id: orgId,
        asset_id: assetId,
        underlying_ticker: underlying,
        transaction_date: parseDate(line.date),
        transaction_type: op,
        quantity: qty,
        unit_price: unitPrice,
        total_gross_value: gross,
        brokerage_fee: line.brokerage_fee ?? 0,
        b3_fees: line.b3_fees ?? 0,
        irrf_tax: line.irrf_tax ?? 0,
        total_net_value: net,
        impacts_managerial_price:
          line.impacts_managerial_price ?? (isCashFlow ? false : true),
        broker_note_ref: line.broker_note_ref ?? null,
        source_batch_id: batchId,
        notes: line.notes ?? null,
      });
      if (line.option_strike != null && line.option_strike > 0) {
        await persistOptionStrikeOnAsset(
          this.gateway,
          ctx,
          assetId,
          line.option_strike,
          line.date
        );
      }
      inserted += 1;
    }

    const reconcile = await this.reconcileCustody(ctx);
    const pendingSync = await this.syncAutoPendingSettlements(ctx);
    return {
      batchId,
      inserted,
      openingDate,
      reconcile,
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
    const assetCache = new Map<string, string>();
    let inserted = 0;
    let skipped = 0;

    const dayRows = await this.gateway.readQuery(ctx, 'invest_ledger_with_assets', [
      orgId,
      openingDate,
      openingDate,
    ]);
    const hasOpeningRef = (ticker: string, types: string[]) =>
      dayRows.some((r) => {
        const ref = String(r.broker_note_ref || '');
        const openingRef =
          ref === OPENING_BATCH_REF || ref === LEGACY_OPENING_BATCH_REF;
        return (
          String(r.asset_ticker).toUpperCase() === ticker &&
          types.includes(String(r.transaction_type)) &&
          openingRef
        );
      });

    const notePrefix = payload.source_label
      ? `Saldo inicial — ${payload.source_label}`
      : 'Saldo inicial da carteira';

    for (const pos of payload.opening_positions || []) {
      const ticker = canonicalTesouroTicker(pos.ticker.trim().toUpperCase());
      if (hasOpeningRef(ticker, ['opening_balance'])) {
        skipped += 1;
        continue;
      }

      const assetType = pos.asset_type || inferAssetType(ticker);
      const assetId = await ensureAsset(this.gateway, ctx, orgId, ticker, assetType, assetCache);
      const underlying = inferUnderlyingTicker(ticker, pos.underlying_ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: pos.quantity,
        unit_price: pos.avg_price,
        date: openingDate,
      });
      const qty = Math.abs(norm.quantity);
      const price = norm.unit_price;
      const gross = qty * price;

      await this.gateway.insert(ctx, 'invest_ledger_entries', {
        id: randomUUID(),
        organization_id: orgId,
        asset_id: assetId,
        underlying_ticker: underlying,
        transaction_date: openingDate,
        transaction_type: 'opening_balance',
        quantity: qty,
        unit_price: price,
        total_gross_value: gross,
        brokerage_fee: 0,
        b3_fees: 0,
        irrf_tax: 0,
        total_net_value: -gross,
        impacts_managerial_price: true,
        broker_note_ref: OPENING_BATCH_REF,
        source_batch_id: batchId,
        notes: pos.notes ? `${notePrefix} — ${pos.notes}` : notePrefix,
      });
      inserted += 1;
    }

    for (const line of payload.opening_short_options || []) {
      const ticker = line.ticker.trim().toUpperCase();
      const op = line.operation;
      if (hasOpeningRef(ticker, ['put_sell', 'call_sell'])) {
        skipped += 1;
        continue;
      }

      const assetType = inferAssetType(ticker);
      const assetId = await ensureAsset(this.gateway, ctx, orgId, ticker, assetType, assetCache);
      const underlying = inferUnderlyingTicker(ticker, line.underlying_ticker);
      const qty = signedQuantity(op, Number(line.quantity));
      const unitPrice = Number(line.unit_price);
      const gross = Math.abs(qty) * unitPrice;

      await this.gateway.insert(ctx, 'invest_ledger_entries', {
        id: randomUUID(),
        organization_id: orgId,
        asset_id: assetId,
        underlying_ticker: underlying,
        transaction_date: openingDate,
        transaction_type: op,
        quantity: qty,
        unit_price: unitPrice,
        total_gross_value: gross,
        brokerage_fee: 0,
        b3_fees: 0,
        irrf_tax: 0,
        total_net_value: 0,
        impacts_managerial_price: true,
        broker_note_ref: OPENING_BATCH_REF,
        source_batch_id: batchId,
        notes: line.notes ? `${notePrefix} — ${line.notes}` : `${notePrefix} (short)`,
      });
      inserted += 1;
    }

    const reconcile = await this.reconcileCustody(ctx);
    return { batchId, inserted, skipped, openingDate, reconcile };
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
    const assetCache = new Map<string, string>();
    let inserted = 0;
    let skipped = 0;

    const existingRefs = new Set<string>();
    const refRows = await this.gateway.readQuery(ctx, 'invest_ledger_note_refs', [orgId]);
    for (const r of refRows) {
      const ref = r.broker_note_ref ? String(r.broker_note_ref).trim() : '';
      if (ref) existingRefs.add(ref);
    }

    for (const line of entries || []) {
      const ref = line.broker_note_ref?.trim();
      if (ref && existingRefs.has(ref)) {
        skipped += 1;
        continue;
      }

      const op = String(line.operation);
      if (!LEDGER_TRANSACTION_TYPES.includes(op as (typeof LEDGER_TRANSACTION_TYPES)[number])) {
        throw new GatewayError('INVALID_PAYLOAD', `Operação não suportada: ${op}`, 400);
      }

      const ticker = canonicalTesouroTicker(line.ticker.trim().toUpperCase());
      const assetType = line.asset_type || inferAssetType(ticker);
      const assetId = await ensureAsset(this.gateway, ctx, orgId, ticker, assetType, assetCache);
      const underlying = inferUnderlyingTicker(ticker, line.underlying_ticker);
      const norm = normalizeLedgerLineQuantity(ticker, {
        quantity: line.quantity,
        unit_price: line.unit_price,
        total_net_value: line.total_net_value,
        date: line.date,
      });
      const qty = signedQuantity(op, norm.quantity);
      const unitPrice = norm.unit_price;
      const gross = Math.abs(qty) * unitPrice;
      const net = computeNet(line);

      const isCashFlow = [
        'capital_deposit',
        'capital_withdrawal',
        'cash_yield',
        'penalty_b3',
        'fee',
        'pending_settlement',
      ].includes(op);

      await this.gateway.insert(ctx, 'invest_ledger_entries', {
        id: randomUUID(),
        organization_id: orgId,
        asset_id: assetId,
        underlying_ticker: underlying,
        transaction_date: parseDate(line.date),
        transaction_type: op,
        quantity: qty,
        unit_price: unitPrice,
        total_gross_value: gross,
        brokerage_fee: line.brokerage_fee ?? 0,
        b3_fees: line.b3_fees ?? 0,
        irrf_tax: line.irrf_tax ?? 0,
        total_net_value: net,
        impacts_managerial_price:
          line.impacts_managerial_price ?? (isCashFlow ? false : true),
        broker_note_ref: line.broker_note_ref ?? null,
        source_batch_id: batchId,
        notes: line.notes
          ? meta?.sourceLabel
            ? `${line.notes} (${meta.sourceLabel})`
            : line.notes
          : meta?.sourceLabel || null,
      });
      if (line.option_strike != null && line.option_strike > 0) {
        await persistOptionStrikeOnAsset(
          this.gateway,
          ctx,
          assetId,
          line.option_strike,
          line.date
        );
      }
      inserted += 1;
      if (ref) existingRefs.add(ref);
    }

    const reconcile = await this.reconcileCustody(ctx);
    return { batchId, inserted, skipped, reconcile };
  }

  /** Cria `pending_settlement` automáticos (D+2) para patrimônio bater com a conta. */
  async syncAutoPendingSettlements(ctx: UserContext) {
    const orgId = ctx.organizationId!;
    const from = '2000-01-01';
    const to = new Date().toISOString().slice(0, 10);
    const events = await this.listLedgerEvents(ctx, from, to);
    const assetCache = new Map<string, string>();
    const cashAssetId = await ensureAsset(
      this.gateway,
      ctx,
      orgId,
      'CAIXA-BTG',
      'cash',
      assetCache
    );
    return syncAutoPendingSettlements(this.gateway, ctx, events, {
      orgId,
      cashAssetId,
    });
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
    const rows = await this.gateway.readQuery(ctx, 'invest_ledger_with_assets', [
      orgId,
      from,
      to,
    ]);
    return rows.map((r) => ({
      id: String(r.id),
      transaction_date: normalizeLedgerDate(r.transaction_date),
      broker_note_ref: r.broker_note_ref ? String(r.broker_note_ref) : null,
      notes: r.notes ? String(r.notes) : null,
      asset_id: String(r.asset_id),
      asset_ticker: String(r.asset_ticker),
      asset_type: String(r.asset_type),
      underlying_ticker: r.underlying_ticker ? String(r.underlying_ticker) : null,
      transaction_type: String(r.transaction_type),
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      total_net_value: Number(r.total_net_value),
      brokerage_fee: Number(r.brokerage_fee ?? 0),
      b3_fees: Number(r.b3_fees ?? 0),
      irrf_tax: Number(r.irrf_tax ?? 0),
      impacts_managerial_price:
        r.impacts_managerial_price == null
          ? null
          : Boolean(r.impacts_managerial_price),
    }));
  }

  async reconcileCustody(ctx: UserContext) {
    const orgId = ctx.organizationId!;
    const from = '2000-01-01';
    const to = new Date().toISOString().slice(0, 10);
    const events = await this.listLedgerEvents(ctx, from, to);
    const { assets, processedEntries } = rebuildCustodyFromLedger(events);

    const existing = await this.gateway.findWhere(ctx, 'invest_assets', {
      organization_id: orgId,
    });

    const activeIds = new Set(assets.map((a) => a.assetId));

    for (const a of assets) {
      await this.gateway.update(ctx, 'invest_assets', a.assetId, {
        current_quantity: a.quantity,
        managerial_avg_price: a.avgPrice,
        status: 'active',
      });
    }

    for (const row of existing) {
      const id = String(row.id);
      if (!activeIds.has(id)) {
        await this.gateway.update(ctx, 'invest_assets', id, {
          current_quantity: 0,
          status: 'liquidated',
        });
      }
    }

    for (const row of existing) {
      const qty = Number(row.current_quantity ?? 0);
      const ticker = String(row.asset_ticker ?? '').toUpperCase();
      const assetType = String(row.asset_type ?? '');
      const isFi =
        assetType === 'fixed_income' ||
        ticker.startsWith('TESOURO-') ||
        ticker.startsWith('CDB-') ||
        ticker.startsWith('LFT-') ||
        ticker.startsWith('TD-');
      if (!isFi || qty > 1e-9) continue;
      if (qty >= -1e-9) continue;
      await this.gateway.update(ctx, 'invest_assets', String(row.id), {
        current_quantity: 0,
        managerial_avg_price: 0,
        status: 'liquidated',
      });
    }

    const pendingSync = await this.syncAutoPendingSettlements(ctx);

    return { processedEntries, positions: assets.length, pendingSync };
  }
}
