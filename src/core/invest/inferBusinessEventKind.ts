import type { BusinessEventKind } from '../business-events/types';
import type { LedgerImportLine } from './ledgerTypes';

const B3_NOTE_REF = /^(B3|BTG)-NOTA-/i;

/**
 * Infere o kind canonico do header business_events a partir da linha de import.
 * Notas de corretagem seguem padrao B3 (event_source_ref B3-NOTA-{numero}).
 * Extrato BTG usa prefixos BTG-* ou categoria 3 (cash puro).
 */
export function inferBusinessEventKind(
  line: LedgerImportLine,
  defaultKind: BusinessEventKind | string
): BusinessEventKind | string {
  const ref = String(line.event_source_ref || '').trim();

  if (ref.startsWith('BTG-TD:')) return 'treasury_direct';
  if (ref.startsWith('BTG-BTC-')) return 'broker_note_loan';
  if (ref.startsWith('BTG-CUSTODIA-MENSAL:')) return 'cash_movement';
  if (ref.startsWith('BTG-IRRF-OPCAO-MENSAL:')) return 'cash_movement';

  if (B3_NOTE_REF.test(ref)) return defaultKind;

  if (line.source_system === 'btg_extract') {
    if (line.operation === 'cash_yield') return 'cash_yield_event';
    if (line.extract_category === 3) return 'cash_movement';
    if (line.extract_category === 2) return 'cash_movement';
  }

  return defaultKind;
}
