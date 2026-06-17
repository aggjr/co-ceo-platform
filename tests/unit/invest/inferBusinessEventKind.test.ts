import { inferBusinessEventKind } from '../../../src/core/invest/inferBusinessEventKind';
import type { LedgerImportLine } from '../../../src/core/invest/ledgerTypes';

describe('inferBusinessEventKind', () => {
  const base = (patch: Partial<LedgerImportLine>): LedgerImportLine => ({
    date: '2026-01-09',
    ticker: 'PRIO3',
    operation: 'buy',
    quantity: 100,
    unit_price: 50,
    ...patch,
  });

  it('TD do extrato usa treasury_direct', () => {
    const kind = inferBusinessEventKind(
      base({
        event_source_ref: 'BTG-TD:2026-01-09:LFT-20310301',
        source_system: 'btg_extract',
      }),
      'broker_note_spot'
    );
    expect(kind).toBe('treasury_direct');
  });

  it('nota B3 mantem kind da politica de operacao', () => {
    const kind = inferBusinessEventKind(
      base({
        event_source_ref: 'B3-NOTA-31444906',
        source_system: 'b3_brokerage_note',
      }),
      'broker_note_spot'
    );
    expect(kind).toBe('broker_note_spot');
  });

  it('rendimento de caixa no extrato usa cash_yield_event', () => {
    const kind = inferBusinessEventKind(
      base({
        ticker: 'CAIXA-BTG',
        operation: 'cash_yield',
        source_system: 'btg_extract',
        extract_category: 3,
      }),
      'cash_movement'
    );
    expect(kind).toBe('cash_yield_event');
  });

  it('BTC PRIO3 no extrato usa broker_note_loan', () => {
    const kind = inferBusinessEventKind(
      base({
        event_source_ref: 'BTG-BTC-PRIO3:2026-02',
        source_system: 'btg_extract',
      }),
      'cash_movement'
    );
    expect(kind).toBe('broker_note_loan');
  });
});
