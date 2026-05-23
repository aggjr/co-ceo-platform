import {
  brokerageNotesToLedgerLines,
  BTG_NOTE_LEDGER_REF_PREFIX,
} from '../../../src/core/invest/btgBrokerageNoteLedgerTranslator';
import type { BtgBrokerageNote } from '../../../src/core/invest/btgBrokerageNoteParser';

function note(partial: Partial<BtgBrokerageNote> & Pick<BtgBrokerageNote, 'dedupeKey'>): BtgBrokerageNote {
  return {
    noteNumber: '1',
    sheet: '1',
    pregaoDate: '2026-01-10',
    category: 'OPTIONS',
    sourceFile: 'OPTIONS/test.pdf',
    clientCode: '004176105',
    trades: [],
    fees: [],
    netOperations: null,
    netSettlement: null,
    settlementTax: null,
    registrationTax: null,
    cblcTotal: null,
    emoluments: 0.14,
    bovespaTotal: null,
    irrf: null,
    duplicateSkipped: false,
    duplicateOf: null,
    ...partial,
  };
}

describe('btgBrokerageNoteLedgerTranslator', () => {
  it('mapeia venda de PUT para put_sell', () => {
    const lines = brokerageNotesToLedgerLines([
      note({
        dedupeKey: 'O|1|2026-01-10',
        noteNumber: '27421483',
        trades: [
          {
            negotiation: '1-BOVESPA',
            side: 'V',
            marketType: 'OPCAO DE VENDA 01/26',
            operationLabel: 'Venda opção',
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
        settlementTax: 0.11,
        emoluments: 0.14,
      }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].operation).toBe('put_sell');
    expect(lines[0].ticker).toBe('PRIOM385');
    expect(lines[0].broker_note_ref).toContain(BTG_NOTE_LEDGER_REF_PREFIX);
    expect(lines[0].b3_fees).toBeCloseTo(0.25, 2);
    expect(lines[0].total_net_value).toBeCloseTo(399.75, 2);
  });

  it('mapeia exercício para buy no underlying', () => {
    const lines = brokerageNotesToLedgerLines([
      note({
        dedupeKey: 'S|1|2026-01-16',
        noteNumber: '27994603',
        category: 'SPOT',
        pregaoDate: '2026-01-16',
        trades: [
          {
            negotiation: '1-BOVESPA',
            side: 'C',
            marketType: 'EXERC OPC COMPRA',
            operationLabel: 'Exercício',
            sideLabel: 'Compra',
            maturity: null,
            specification: 'EXERC OPC COMPRA PRIOA407E ON',
            ticker: 'PRIOA407E',
            underlyingStock: 'PRIO3',
            isExercise: true,
            quantity: 100,
            unitPrice: 40.75,
            grossValue: 4075,
            dc: 'C',
          },
        ],
        emoluments: 11,
        settlementTax: 1,
      }),
    ]);
    const stockBuy = lines.find((l) => l.ticker === 'PRIO3' && l.operation === 'buy');
    expect(stockBuy).toBeDefined();
    expect(stockBuy!.unit_price).toBe(40.75);
    expect(stockBuy!.option_strike).toBe(40.75);
  });

  it('locação doador → securities_lending', () => {
    const lines = brokerageNotesToLedgerLines([
      note({
        dedupeKey: 'L|1|2026-01-20',
        noteNumber: '87863112',
        category: 'LOAN',
        pregaoDate: '2026-01-20',
        trades: [
          {
            negotiation: 'ALUGUEL',
            side: 'C',
            marketType: 'LOCAÇÃO BTC',
            operationLabel: 'Locação',
            sideLabel: 'Recebimento',
            maturity: null,
            specification: 'OFERTA DOADORA',
            ticker: 'PRIO3',
            underlyingStock: 'PRIO3',
            isExercise: false,
            quantity: 1000,
            unitPrice: 0.00031,
            grossValue: 0.31,
            dc: 'C',
          },
        ],
      }),
    ]);
    expect(lines[0].operation).toBe('securities_lending');
    expect(lines[0].total_net_value).toBeCloseTo(0.31, 4);
  });
});
