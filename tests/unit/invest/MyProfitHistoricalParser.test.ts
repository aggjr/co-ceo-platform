import {
  myProfitRowsToLedgerLines,
  parseMyProfitHistoricalRows,
} from '../../../src/core/invest/MyProfitHistoricalParser';

describe('MyProfitHistoricalParser', () => {
  const header = [
    'Data de negociação',
    'Instituição',
    'Número',
    'Documento',
    'Moeda',
    'Total de Taxas',
    'Ativo',
    'Grupo',
    'Quantidade',
    'Operação',
    'Tipo',
    'Preço sem taxas',
    'Preço com taxas',
    'Total sem taxas',
    'Total com taxas',
    'Obs',
  ];

  it('maps option sell from 2026 row', () => {
    const rows = parseMyProfitHistoricalRows([
      [],
      [],
      [],
      [],
      header,
      [
        46027,
        'BTG Pactual',
        '',
        'B3_BTG Pactual_05012026',
        'BRL',
        0.52,
        'PRIOM385',
        'Opções',
        -2500,
        'Crédito',
        'Venda',
        0.16,
        0.1598,
        400,
        399.48,
        'Normal',
      ],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe('2026-01-05');
    const lines = myProfitRowsToLedgerLines(rows);
    expect(lines[0]!.operation).toBe('put_sell');
    expect(lines[0]!.broker_note_ref).toContain('B3_BTG Pactual_05012026#PRIOM385');
  });

  it('maps E suffix exercise to underlying stock buy', () => {
    const rows = parseMyProfitHistoricalRows([
      [],
      [],
      [],
      [],
      header,
      [
        46108,
        'BTG',
        '',
        'B3_BTG Pactual_17042026',
        'BRL',
        1,
        'PRIOP650E',
        'Opções',
        4000,
        'Débito',
        'Compra',
        65,
        65,
        -260000,
        -260001,
        'Normal',
      ],
    ]);
    const lines = myProfitRowsToLedgerLines(rows);
    expect(lines[0]!.ticker).toBe('PRIO3');
    expect(lines[0]!.operation).toBe('buy');
    expect(lines[0]!.quantity).toBe(4000);
  });

  it('includes december 2025 when no fromDate filter', () => {
    const rows = parseMyProfitHistoricalRows([
      [],
      [],
      [],
      [],
      header,
      [
        45996,
        'BTG',
        '',
        'B3_BTG Pactual_05122025',
        'BRL',
        1,
        'PRIOA407',
        'Opções',
        -5400,
        'Crédito',
        'Venda',
        0.53,
        0.5293,
        100,
        99,
        'Normal',
      ],
    ]);
    expect(rows).toHaveLength(1);
  });

  it('skips december 2025 when fromDate is 2026-01-01', () => {
    const rows = parseMyProfitHistoricalRows(
      [
        [],
        [],
        [],
        [],
        header,
        [
          45996,
          'BTG',
          '',
          'B3_BTG Pactual_05122025',
          'BRL',
          1,
          'PRIOA407',
          'Opções',
          -5400,
          'Crédito',
          'Venda',
          0.53,
          0.5293,
          100,
          99,
          'Normal',
        ],
      ],
      { fromDate: '2026-01-01' }
    );
    expect(rows).toHaveLength(0);
  });
});
