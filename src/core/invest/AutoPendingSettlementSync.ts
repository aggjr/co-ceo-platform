import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import type { LedgerEvent } from './CustodyEngine';
import type { InvestOperations } from '../../modules/invest';
import { inferAssetType } from './assetClassifier';
import { MAIN_CASH_TICKER } from './ledgerTypes';
import { SettlementRulesService } from './SettlementRulesService';

export const AUTO_D2_REF_PREFIX = 'AUTO-D2:';

export function autoD2Ref(ledgerEntryId: string): string {
  return `${AUTO_D2_REF_PREFIX}${ledgerEntryId}`;
}

export type AutoPendingSyncResult = {
  created: number;
  cleared: number;
  skipped: number;
};

type AutoPendingSettlementResolution = {
  ticker: string;
  assetType: string;
  txType: string;
  tradeDate: string;
  settleOn: string;
  ruleLabel: string;
};

async function resolveAutoPendingSettlement(
  rules: SettlementRulesService,
  ctx: UserContext,
  e: LedgerEvent
): Promise<AutoPendingSettlementResolution | null> {
  const ticker = String(e.asset_ticker || '').trim().toUpperCase();
  const tradeDate = String(e.transaction_date || '').slice(0, 10);
  const txType = String(e.transaction_type || '').trim().toLowerCase();
  const assetType = String(e.asset_type || inferAssetType(ticker)).trim().toLowerCase();
  if (!ticker || !tradeDate || !txType || !assetType) return null;

  const rule = await rules.resolveRule(
    {
      tradeDate,
      assetType,
      transactionType: txType,
      ticker,
    },
    ctx
  );
  if (!rule || rule.daysOffset <= 0) return null;

  const settleOn = await rules.resolveSettlementDate(
    {
      tradeDate,
      assetType,
      transactionType: txType,
      ticker,
    },
    ctx
  );

  return {
    ticker,
    assetType,
    txType,
    tradeDate,
    settleOn,
    ruleLabel: rule.label || rule.ruleCode,
  };
}

/**
 * Gera a perna financeira em transicao para operacoes D+n.
 *
 * No replay historico da conciliacao, a pendencia precisa existir no dia D e
 * a baixa precisa existir no D+n, mesmo que ambos sejam datas passadas em
 * relacao a hoje. Isso permite reconstruir o grafico diario de patrimonio e
 * manter a ligacao entre ativo e financeiro pelo mesmo business_event_id.
 */
export async function syncAutoPendingSettlements(
  gateway: CoCeoDataGateway,
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
  const settlementRules = new SettlementRulesService(gateway);

  for (const e of events) {
    if (!e.id) continue;
    const settlement = await resolveAutoPendingSettlement(settlementRules, ctx, e);
    if (!settlement) continue;

    const ref = autoD2Ref(e.id);
    const net = Number(e.total_net_value ?? 0);
    let open = pendingByRef.get(ref) ?? 0;

    if (!settlementRefs.has(ref)) {
      if (Math.abs(net) < 0.01) {
        skipped += 1;
      } else {
        const result = await options.operations.recordOperation(ctx, {
          date: settlement.tradeDate,
          ticker: MAIN_CASH_TICKER,
          operation: 'pending_settlement',
          quantity: 0,
          unit_price: 0,
          total_net_value: net,
          settlement_date: settlement.settleOn,
          broker_note_ref: ref,
          business_event_id: e.business_event_id ?? undefined,
          notes: `Valor em transito - ${settlement.ruleLabel} - liquidacao prevista ${settlement.settleOn} - ${settlement.ticker} (${settlement.txType})`,
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

    if (settlement.settleOn > today) continue;

    if (Math.abs(open) >= 0.01) {
      const result = await options.operations.recordOperation(ctx, {
        date: settlement.settleOn,
        ticker: MAIN_CASH_TICKER,
        operation: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: -open,
        settlement_date: settlement.settleOn,
        broker_note_ref: `${ref}:CLEAR`,
        business_event_id: e.business_event_id ?? undefined,
        notes: `Liquidacao na conta - ${settlement.ruleLabel} - ${settlement.ticker} (${settlement.settleOn})`,
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
