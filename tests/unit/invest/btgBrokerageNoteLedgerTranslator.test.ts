import {
  brokerageNotesToLedgerLines,
  BTG_NOTE_LEDGER_REF_PREFIX,
  suppressBrokerageNoteCashLines,
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
        dedupeKey: 'O|1|2026-01-05',
        pregaoDate: '2026-01-05',
        noteNumber: '27421483',
        netSettlement: 399.48,
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
        registrationTax: 0.27,
        emoluments: 0.14,
      }),
    ]);
    const trade = lines.find((l) => l.operation === 'put_sell');
    const fees = lines.filter((l) => l.operation === 'fee');
    expect(trade).toBeDefined();
    expect(trade!.ticker).toBe('PRIOM385');
    expect(trade!.broker_note_ref).toContain(BTG_NOTE_LEDGER_REF_PREFIX);
    expect(trade!.b3_fees).toBeCloseTo(0.52, 2);
    expect(trade!.total_net_value).toBeCloseTo(400, 2);
    expect(fees).toHaveLength(3);
    expect(fees.every((f) => f.broker_note_ref?.includes('#1#FEE-'))).toBe(true);
    expect(fees.reduce((s, l) => s + Math.abs(Number(l.total_net_value)), 0)).toBeCloseTo(0.52, 2);
    const netPending =
      Number(trade!.total_net_value) +
      fees.reduce((s, l) => s + Number(l.total_net_value), 0);
    expect(netPending).toBeCloseTo(399.48, 2);
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
    expect(lines[0].total_net_value).toBe(0);
  });

  it('nota com dois itens: bruto por trade e taxas rateadas por item', () => {
    const lines = brokerageNotesToLedgerLines([
      note({
        dedupeKey: 'O|2|2026-01-07',
        pregaoDate: '2026-01-07',
        noteNumber: '27422000',
        netSettlement: 1_499.4,
        trades: [
          {
            negotiation: '1-BOVESPA',
            side: 'V',
            marketType: 'OPCAO DE VENDA 01/26',
            operationLabel: 'Venda opção',
            sideLabel: 'Venda',
            maturity: '01/26',
            specification: '',
            ticker: 'PRIOA410',
            underlyingStock: 'PRIO3',
            isExercise: false,
            quantity: 1000,
            unitPrice: 1,
            grossValue: 1_000,
            dc: 'C',
          },
          {
            negotiation: '1-BOVESPA',
            side: 'V',
            marketType: 'OPCAO DE VENDA 01/26',
            operationLabel: 'Venda opção',
            sideLabel: 'Venda',
            maturity: '01/26',
            specification: '',
            ticker: 'PRIOA415',
            underlyingStock: 'PRIO3',
            isExercise: false,
            quantity: 500,
            unitPrice: 1,
            grossValue: 500,
            dc: 'C',
          },
        ],
        settlementTax: 0.2,
        registrationTax: 0.2,
        emoluments: 0.2,
      }),
    ]);
    const trades = lines.filter((l) => l.operation === 'put_sell' || l.operation === 'call_sell');
    const fees = lines.filter((l) => l.operation === 'fee');
    expect(trades).toHaveLength(2);
    expect(trades[0]!.total_net_value).toBeCloseTo(1_000, 2);
    expect(trades[1]!.total_net_value).toBeCloseTo(500, 2);
    expect(fees.some((f) => f.broker_note_ref?.includes('#1#FEE-'))).toBe(true);
    expect(fees.some((f) => f.broker_note_ref?.includes('#2#FEE-'))).toBe(true);
    const netPending =
      trades.reduce((s, l) => s + Number(l.total_net_value), 0) +
      fees.reduce((s, l) => s + Number(l.total_net_value), 0);
    expect(netPending).toBeCloseTo(1_499.4, 2);
  });

  it('maps regular SPOT stock note to buy', () => {
    const lines = brokerageNotesToLedgerLines([
      note({
        dedupeKey: 'S|2|2026-02-10',
        noteNumber: '27994604',
        category: 'SPOT',
        pregaoDate: '2026-02-10',
        emoluments: 0,
        trades: [
          {
            negotiation: '1-BOVESPA',
            side: 'C',
            marketType: 'VISTA',
            operationLabel: 'Compra',
            sideLabel: 'Compra',
            maturity: null,
            specification: 'PRIO3 ON',
            ticker: 'PRIO3',
            underlyingStock: 'PRIO3',
            isExercise: false,
            quantity: 500,
            unitPrice: 42.5,
            grossValue: 21250,
            dc: 'D',
          },
        ],
      }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      ticker: 'PRIO3',
      operation: 'buy',
      quantity: 500,
      unit_price: 42.5,
    });
  });

  it('suppresses note cash without erasing patrimony pricing inputs', () => {
    const suppressed = suppressBrokerageNoteCashLines([
      {
        date: '2026-02-10',
        ticker: 'PRIO3',
        asset_type: 'stock',
        operation: 'buy',
        quantity: 500,
        unit_price: 42.5,
        total_net_value: -21250,
      },
      {
        date: '2026-01-05',
        ticker: 'PRIOM385',
        asset_type: 'option_put',
        operation: 'fee',
        quantity: 0,
        unit_price: 0.11,
        total_net_value: -0.11,
      },
    ]);
    expect(suppressed[0].skip_financial_ledger).toBe(true);
    expect(suppressed[1].skip_financial_ledger).toBe(true);
  });
});
