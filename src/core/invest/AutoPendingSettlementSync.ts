import { randomUUID } from 'crypto';
import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import type { LedgerEvent } from './CustodyEngine';
import {
  cashSettlementDate,
  isOptionPremiumSell,
  isStockLikeAsset,
} from './settlementCalendar';

export const AUTO_D2_REF_PREFIX = 'AUTO-D2:';

export function autoD2Ref(ledgerEntryId: string): string {
  return `${AUTO_D2_REF_PREFIX}${ledgerEntryId}`;
}

function isDeferredStockTrade(e: LedgerEvent): boolean {
  const type = String(e.transaction_type);
  const assetType = String(e.asset_type || 'stock');
  return isStockLikeAsset(assetType) && (type === 'buy' || type === 'sell');
}

function isDeferredOptionPremium(e: LedgerEvent): boolean {
  const type = String(e.transaction_type);
  const assetType = String(e.asset_type || '');
  return isOptionPremiumSell(assetType, type);
}

function defersCashSettlementEvent(e: LedgerEvent): boolean {
  return isDeferredStockTrade(e) || isDeferredOptionPremium(e);
}

export type AutoPendingSyncResult = {
  created: number;
  cleared: number;
  skipped: number;
};

/**
 * Gera `pending_settlement` no livro-razão para compras/vendas de ação com pagamento D+2,
 * mantendo o patrimônio alinhado ao BTG (lançamento futuro até liquidar).
 */
export async function syncAutoPendingSettlements(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  events: LedgerEvent[],
  options: {
    today?: string;
    cashAssetId: string;
    orgId: string;
  }
): Promise<AutoPendingSyncResult> {
  const today = (options.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const pendingByRef = new Map<string, number>();

  for (const e of events) {
    if (String(e.transaction_type) !== 'pending_settlement') continue;
    const ref = String(e.broker_note_ref || '');
    if (!ref.startsWith(AUTO_D2_REF_PREFIX)) continue;
    pendingByRef.set(ref, (pendingByRef.get(ref) ?? 0) + Number(e.total_net_value ?? 0));
  }

  let created = 0;
  let cleared = 0;
  let skipped = 0;

  for (const e of events) {
    if (!e.id || !defersCashSettlementEvent(e)) continue;

    const ref = autoD2Ref(e.id);
    const tradeDate = String(e.transaction_date || '').slice(0, 10);
    if (!tradeDate) continue;

    const settleOn = cashSettlementDate(
      tradeDate,
      String(e.asset_type || 'stock'),
      String(e.transaction_type)
    );
    const net = Number(e.total_net_value ?? 0);
    const open = pendingByRef.get(ref) ?? 0;

    if (settleOn > today) {
      if (Math.abs(open) < 0.01) {
        await gateway.insert(ctx, 'invest_ledger_entries', {
          id: randomUUID(),
          organization_id: options.orgId,
          asset_id: options.cashAssetId,
          underlying_ticker: null,
          transaction_date: tradeDate,
          transaction_type: 'pending_settlement',
          quantity: 0,
          unit_price: 0,
          total_gross_value: 0,
          brokerage_fee: 0,
          b3_fees: 0,
          irrf_tax: 0,
          total_net_value: net,
          impacts_managerial_price: false,
          broker_note_ref: ref,
          source_batch_id: null,
          notes: `Previsão pagamento D+2 — ${e.asset_ticker} (${String(e.transaction_type)})`,
        });
        pendingByRef.set(ref, net);
        created += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    if (Math.abs(open) >= 0.01) {
      await gateway.insert(ctx, 'invest_ledger_entries', {
        id: randomUUID(),
        organization_id: options.orgId,
        asset_id: options.cashAssetId,
        underlying_ticker: null,
        transaction_date: settleOn,
        transaction_type: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_gross_value: 0,
        brokerage_fee: 0,
        b3_fees: 0,
        irrf_tax: 0,
        total_net_value: -open,
        impacts_managerial_price: false,
        broker_note_ref: `${ref}:CLEAR`,
        source_batch_id: null,
        notes: `Liquidação D+2 — ${e.asset_ticker}`,
      });
      pendingByRef.set(ref, 0);
      cleared += 1;
    }
  }

  return { created, cleared, skipped };
}
