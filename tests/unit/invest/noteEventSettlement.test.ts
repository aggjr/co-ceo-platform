import {
  assessNoteInternalPool,
  assessNoteSettlement,
  eventSourceRefForTrade,
  poolCentsForNoteLines,
} from '../../../src/core/invest/noteEventSettlement';
import type { BtgBrokerageNote } from '../../../src/core/invest/btgBrokerageNoteParser';
import {
  brokerageNotesToLedgerLines,
  suppressBrokerageNoteCashLines,
} from '../../../src/core/invest/btgBrokerageNoteLedgerTranslator';

function note(partial: Partial<BtgBrokerageNote>): BtgBrokerageNote {
  return {
    dedupeKey: 'S|1|2026-01-05',
    noteNumber: '27421483',
    sheet: '1',
    pregaoDate: '2026-01-05',
    category: 'OPTIONS',
    sourceFile: 'test.pdf',
    clientCode: '004176105',
    trades: [],
    fees: [],
    netOperations: null,
    netSettlement: 399.48,
    settlementTax: 0.11,
    registrationTax: 0.27,
    emoluments: 0.14,
    cblcTotal: null,
    bovespaTotal: null,
    irrf: null,
    duplicateSkipped: false,
    duplicateOf: null,
    ...partial,
  };
}

describe('noteEventSettlement', () => {
  it('event_source_ref e 1 header por linha operacional', () => {
    const lines = suppressBrokerageNoteCashLines(
      brokerageNotesToLedgerLines([
        note({
          trades: [
            {
              negotiation: '1-BOVESPA',
              side: 'V',
              marketType: 'OPCAO DE VENDA 01/26',
              operationLabel: 'Venda',
              sideLabel: 'Venda',
              maturity: '01/26',
              specification: '',
              ticker: 'PRIOM385',
              underlyingStock: 'PRIO3',
              isExercise: false,
              quantity: 2500,
              unitPrice: 0.16,
              grossValue: 400,
              dc: 'C',
            },
          ],
        }),
      ])
    );
    expect(lines.find((l) => l.operation === 'put_sell')?.event_source_ref).toBe(
      eventSourceRefForTrade('27421483', 1)
    );
  });

  it('pool pending bate com liquido da nota', () => {
    const n = note({
      trades: [
        {
          negotiation: '1-BOVESPA',
          side: 'V',
          marketType: 'OPCAO DE VENDA 01/26',
          operationLabel: 'Venda',
          sideLabel: 'Venda',
          maturity: '01/26',
          specification: '',
          ticker: 'PRIOM385',
          underlyingStock: 'PRIO3',
          isExercise: false,
          quantity: 2500,
          unitPrice: 0.16,
          grossValue: 400,
          dc: 'C',
        },
      ],
    });
    const lines = suppressBrokerageNoteCashLines(brokerageNotesToLedgerLines([n]));
    const internal = assessNoteInternalPool(n, lines);
    expect(internal.poolOk).toBe(true);
    expect(internal.poolCents).toBe(39948);
  });

  it('nota sem LIQ fica waiting', () => {
    const n = note({
      trades: [
        {
          negotiation: '1-BOVESPA',
          side: 'V',
          marketType: 'OPCAO DE VENDA 01/26',
          operationLabel: 'Venda',
          sideLabel: 'Venda',
          maturity: '01/26',
          specification: '',
          ticker: 'PRIOM385',
          underlyingStock: 'PRIO3',
          isExercise: false,
          quantity: 2500,
          unitPrice: 0.16,
          grossValue: 400,
          dc: 'C',
        },
      ],
    });
    const lines = suppressBrokerageNoteCashLines(brokerageNotesToLedgerLines([n]));
    const assessment = assessNoteSettlement(n, lines, 0);
    expect(assessment.status).toBe('waiting');
    expect(poolCentsForNoteLines(lines, n.noteNumber)).toBe(39948);
  });
});
