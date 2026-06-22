import type { UserContext } from '../dal';
import type { LedgerEvent } from './CustodyEngine';
import type { LedgerImportService } from './LedgerImportService';
import { type LedgerImportLine } from './ledgerTypes';

/** Ticker sintetico de auditoria — nao e ativo negociavel. */
export const PATRIMONY_DIVERGENCE_TICKER = 'AUDIT-PATRIMONIO';

/** Residuo minimo para registrar divergencia patrimonial vs ancora. */
export const PATRIMONY_ANCHOR_DIVERGENCE_TOLERANCE = 1;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function divergenceSourceRef(asOf: string, centsSigned: number): string {
  return `PAT-DIV:${asOf}:delta:${centsSigned}`;
}

function hasExistingDivergenceRef(events: LedgerEvent[], ref: string): boolean {
  const target = ref.trim();
  if (!target) return false;
  return events.some((e) => {
    const noteRef = String(e.broker_note_ref || '').trim();
    const sourceRef = String(
      (e as LedgerEvent & { event_source_ref?: string }).event_source_ref || ''
    ).trim();
    return noteRef === target || sourceRef === target || noteRef.startsWith(`${target}:`);
  });
}

/**
 * Linha de divergencia nao explicada: patrimonio economico vs ancora BTG.
 * delta = economicPatrimony - anchorPatrimony (positivo = sistema acima da ancora).
 */
export function buildPatrimonyAnchorDivergenceLine(
  asOf: string,
  economicPatrimony: number,
  anchorPatrimony: number
): LedgerImportLine | null {
  const delta = roundMoney(economicPatrimony - anchorPatrimony);
  if (Math.abs(delta) <= PATRIMONY_ANCHOR_DIVERGENCE_TOLERANCE) return null;
  const centsSigned = Math.round(delta * 100);
  const ref = divergenceSourceRef(asOf, centsSigned);
  return {
    date: asOf,
    ticker: PATRIMONY_DIVERGENCE_TICKER,
    operation: 'patrimony_anchor_divergence',
    quantity: 0,
    unit_price: 0,
    total_net_value: delta,
    asset_type: 'cash',
    impacts_managerial_price: false,
    broker_note_ref: ref,
    event_source_ref: ref,
    source_system: 'patrimony_anchor_reconcile',
    notes:
      `Divergencia patrimonio: economico R$ ${economicPatrimony.toFixed(2)} vs ancora R$ ${anchorPatrimony.toFixed(2)} ` +
      `(delta R$ ${delta.toFixed(2)})`,
  };
}

export async function ensurePatrimonyAnchorDivergence(
  ctx: UserContext,
  ledger: LedgerImportService,
  events: LedgerEvent[],
  asOf: string,
  economicPatrimony: number,
  anchorPatrimony: number
): Promise<{ created: number; skipped: number; delta: number | null }> {
  const line = buildPatrimonyAnchorDivergenceLine(asOf, economicPatrimony, anchorPatrimony);
  if (!line?.event_source_ref) {
    return { created: 0, skipped: 0, delta: null };
  }

  if (hasExistingDivergenceRef(events, line.event_source_ref)) {
    return { created: 0, skipped: 1, delta: line.total_net_value ?? null };
  }

  const result = await ledger.importEntriesOnly(ctx, [line], {
    sourceLabel: 'patrimony anchor divergence',
  });
  return {
    created: result.inserted,
    skipped: result.skipped,
    delta: line.total_net_value ?? null,
  };
}
