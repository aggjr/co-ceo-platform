import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import type { LedgerEvent } from './CustodyEngine';
import type { InvestOperations } from '../../modules/invest';
import {
  cashSettlementDate,
  cashSettlementRuleLabel,
  defersCashSettlement,
  resolveAssetTypeForSettlement,
} from './settlementCalendar';
import { MAIN_CASH_TICKER } from './ledgerTypes';

export const AUTO_D2_REF_PREFIX = 'AUTO-D2:';

export function autoD2Ref(ledgerEntryId: string): string {
  return `${AUTO_D2_REF_PREFIX}${ledgerEntryId}`;
}

function defersCashSettlementEvent(e: LedgerEvent): boolean {
  const ticker = String(e.asset_ticker || '');
  const assetType = resolveAssetTypeForSettlement(ticker, String(e.asset_type));
  return defersCashSettlement(assetType, String(e.transaction_type), ticker);
}

export type AutoPendingSyncResult = {
  created: number;
  cleared: number;
  skipped: number;
};

/**
 * Gera a perna financeira em transicao para operacoes D+n.
 *
 * No replay historico da conciliacao, a pendencia precisa existir no dia D e
 * a baixa precisa existir no D+n, mesmo que ambos sejam datas passadas em
 * relacao a hoje. Isso permite reconstruir o grafico diario de patrimonio e
 * manter a ligacao entre ativo e financeiro pelo mesmo business_event_id.
 */
export async function syncAutoPendingSettlements(
  _gateway: CoCeoDataGateway,
  ctx: UserContext,
  events: LedgerEvent[],
  options: {
    today?: string;
    operations: InvestOperations;
  }
): Promise<AutoPendingSyncResult> {
  const today = (options.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const pendingByRef = new Map<string, number>();
  const settlementRefs = new Set<string>();

  for (const e of events) {
    if (String(e.transaction_type) !== 'pending_settlement') continue;
    const rawRef = String(e.broker_note_ref || '');
    if (!rawRef.startsWith(AUTO_D2_REF_PREFIX)) continue;
    const baseRef = rawRef.endsWith(':CLEAR') ? rawRef.slice(0, -':CLEAR'.length) : rawRef;
    settlementRefs.add(baseRef);
    pendingByRef.set(baseRef, (pendingByRef.get(baseRef) ?? 0) + Number(e.total_net_value ?? 0));
  }

  let created = 0;
  let cleared = 0;
  let skipped = 0;

  for (const e of events) {
    if (!e.id || !defersCashSettlementEvent(e)) continue;

    const ref = autoD2Ref(e.id);
    const tradeDate = String(e.transaction_date || '').slice(0, 10);
    if (!tradeDate) continue;

    const ticker = String(e.asset_ticker || '');
    const assetType = resolveAssetTypeForSettlement(ticker, String(e.asset_type));
    const txType = String(e.transaction_type);
    const settleOn = cashSettlementDate(tradeDate, assetType, txType, ticker);
    const net = Number(e.total_net_value ?? 0);
    const rule = cashSettlementRuleLabel(assetType, txType, ticker, tradeDate);
    let open = pendingByRef.get(ref) ?? 0;

    if (!settlementRefs.has(ref)) {
      if (Math.abs(net) < 0.01) {
        skipped += 1;
      } else {
        const result = await options.operations.recordOperation(ctx, {
          date: tradeDate,
          ticker: MAIN_CASH_TICKER,
          operation: 'pending_settlement',
          quantity: 0,
          unit_price: 0,
          total_net_value: net,
          settlement_date: settleOn,
          broker_note_ref: ref,
          business_event_id: e.business_event_id ?? undefined,
          notes: `Valor em transito - ${rule} - liquidacao prevista ${settleOn} - ${ticker} (${txType})`,
          asset_type: 'cash',
        });
        if (!result.skipped) {
          pendingByRef.set(ref, net);
          settlementRefs.add(ref);
          open = net;
          created += 1;
        } else {
          skipped += 1;
        }
      }
    }

    if (settleOn > today) continue;

    if (Math.abs(open) >= 0.01) {
      const result = await options.operations.recordOperation(ctx, {
        date: settleOn,
        ticker: MAIN_CASH_TICKER,
        operation: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: -open,
        settlement_date: settleOn,
        broker_note_ref: `${ref}:CLEAR`,
        business_event_id: e.business_event_id ?? undefined,
        notes: `Liquidacao na conta - ${rule} - ${ticker} (${settleOn})`,
        asset_type: 'cash',
      });
      if (!result.skipped) {
        pendingByRef.set(ref, 0);
        cleared += 1;
      } else {
        skipped += 1;
      }
    }
  }

  return { created, cleared, skipped };
}
