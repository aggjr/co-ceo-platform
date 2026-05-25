import type { LedgerImportLine } from './ledgerTypes';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
import type { BrokerCustodySnapshotRecord } from './brokerCustodySnapshotTypes';

export const PENDING_LEDGER_SOURCE = 'broker_custody_snapshot_pending';

const PENDING_KINDS = new Set(['pending_open', 'pending_topup', 'pending_migrate']);

function operationFor(ticker: string, quantity: number): LedgerImportLine['operation'] {
  const type = inferAssetType(ticker);
  if (type === 'option_call') return quantity < 0 ? 'call_sell' : 'call_buy';
  if (type === 'option_put') return quantity < 0 ? 'put_sell' : 'put_buy';
  return quantity < 0 ? 'sell' : 'buy';
}

function pendingEventRef(referenceDate: string): string {
  return `BROKER-SNAPSHOT-PENDING:${referenceDate}`;
}

/** Linhas provisórias (aguardando nota) a partir do snapshot no banco. */
export function buildPendingLedgerLinesFromSnapshot(
  snapshot: BrokerCustodySnapshotRecord
): LedgerImportLine[] {
  const ref = pendingEventRef(snapshot.referenceDate);
  const lines: LedgerImportLine[] = [];

  for (const row of snapshot.positions) {
    if (!PENDING_KINDS.has(row.lineKind)) continue;
    const ticker = row.ticker.toUpperCase();
    const avg = Number(row.avgPrice ?? 0);
    const qty = Number(row.quantity);
    const leg = row.legTag ?? row.lineKind;
    const op = operationFor(ticker, qty);
    const gross = Math.round(Math.abs(qty) * avg * 100) / 100;

    lines.push({
      date: snapshot.referenceDate,
      ticker,
      operation: op,
      quantity: qty,
      unit_price: avg,
      total_net_value: gross,
      underlying_ticker: inferUnderlyingTicker(ticker),
      asset_type: inferAssetType(ticker),
      broker_note_ref: `${ref}:${ticker}#${leg}`,
      event_source_ref: ref,
      source_system: PENDING_LEDGER_SOURCE,
      counterparty: 'BTG Pactual',
      notes:
        'Custódia homebroker (snapshot importado). Nota de corretagem pendente — conferir taxas quando disponível.',
    });
  }

  return lines;
}

export function pendingEventRefForDate(referenceDate: string): string {
  return pendingEventRef(referenceDate);
}
