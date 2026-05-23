import {
  aggregateNoteFees,
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  parseBrMoney,
  parseFeeLine,
  parseNetSettlementLine,
} from '../../../src/core/invest/btgBrokerageNoteParser';

const SAMPLE = `
NOTA DE CORRETAGEM
27421483
Nr. nota
1
Folha
05/01/2026
Data pregão
004176105
Negócios realizados
1-BOVESPA V OPCAO DE VENDA 01/26 PRIOM385 ON 2500 0,16 400,00 C
Resumo dos Negócios
400,00 Valor líquido das operações C
0,11 Taxa de liquidação/CCP D
0,14 Emolumentos D
NOTA DE CORRETAGEM
27421483
Nr. nota
2
Folha
05/01/2026
Data pregão
1-BOVESPA V OPCAO DE VENDA 01/26 PRIOM385 ON 2500 0,16 400,00 C
400,00 Valor líquido das operações C
`.trim().split('\n');

describe('btgBrokerageNoteParser', () => {
  it('parseFeeLine aceita label antes do valor', () => {
    const f = parseFeeLine('Taxa de liquidação/CCP 0,11 D');
    expect(f?.amount).toBe(0.11);
    expect(f?.label).toMatch(/liquida/i);
  });

  it('parseFeeLine aceita formato R$', () => {
    const f = parseFeeLine('Emolumentos: R$ 0,14 D');
    expect(f?.amount).toBe(0.14);
  });

  it('ignora Total CBLC a crédito (subtotal, não taxa)', () => {
    expect(parseFeeLine('399,62 Total CBLC C')).toBeNull();
    expect(parseFeeLine('0,11 Taxa de liquidação/CCP D')?.amount).toBe(0.11);
  });

  it('parseNetSettlementLine extrai líquido final da nota', () => {
    expect(parseNetSettlementLine('Líquido para 06/01/2026 C 399,48')).toBe(399.48);
  });

  it('não confunde linha de exercício com taxa (EXERC ≠ execução)', () => {
    expect(
      parseFeeLine('1-BOVESPA C EXERC OPC COMPRA PRIOD585E ON 700 58,50 40950,00 D')
    ).toBeNull();
  });

  it('aggregateNoteFees soma débitos BTG (layout real jan/2026)', () => {
    const lines = `
NOTA DE CORRETAGEM
27421483
Nr. nota
1
Folha
05/01/2026
Data pregão
Negócios realizados
1-BOVESPA V OPCAO DE VENDA 01/26 PRIOM385 ON 2500 0,16 400,00 C
Resumo dos Negócios
400,00 Valor líquido das operações C
0,11 Taxa de liquidação/CCP D
0,27 Taxa de registro D
399,62 Total CBLC C
0,14 Emolumentos D
0,14 Total Bovespa / Soma D
 Total corretagem / Despesas 0,00
 Líquido para 06/01/2026 C 399,48
`.trim().split('\n');
    const notes = parseBtgBrokerageNoteBlocks(lines, 'OPTIONS/test.pdf', 'OPTIONS');
    const agg = aggregateNoteFees(notes[0]!);
    expect(agg.totalDebit).toBeCloseTo(0.52, 2);
    expect(notes[0]!.netSettlement).toBeCloseTo(399.48, 2);
  });

  it('parseBrMoney', () => {
    expect(parseBrMoney('220.050,00')).toBe(220050);
    expect(parseBrMoney('0,16')).toBe(0.16);
  });

  it('extrai nota e negócio de opção', () => {
    const notes = parseBtgBrokerageNoteBlocks(SAMPLE, 'OPTIONS/test.pdf', 'OPTIONS');
    expect(notes).toHaveLength(2);
    expect(notes[0].noteNumber).toBe('27421483');
    expect(notes[0].pregaoDate).toBe('2026-01-05');
    expect(notes[0].trades[0].ticker).toBe('PRIOM385');
    expect(notes[0].trades[0].underlyingStock).toBe('PRIO3');
    expect(notes[0].trades[0].operationLabel).toBe('Venda opção');
    expect(notes[0].trades[0].quantity).toBe(2500);
    expect(notes[0].emoluments).toBe(0.14);
  });

  it('exercício: opção no ativo, ação PRIO3, tipo Exercício', () => {
    const lines = `
NOTA DE CORRETAGEM
27994603
Nr. nota
1
Folha
16/01/2026
Data pregão
Negócios realizados
1-BOVESPA V EXERC OPC COMPRA PRIOA407E ON 5400 40,75 220.050,00 C
Resumo dos Negócios
`.trim().split('\n');
    const notes = parseBtgBrokerageNoteBlocks(lines, 'SPOT/test.pdf', 'SPOT');
    const t = notes[0].trades[0];
    expect(t.ticker).toBe('PRIOA407E');
    expect(t.underlyingStock).toBe('PRIO3');
    expect(t.operationLabel).toBe('Exercício');
    expect(t.sideLabel).toBe('Compra');
    expect(t.unitPrice).toBe(40.75);
    expect(t.grossValue).toBe(220050);
  });

  it('locação doador: valor líquido recebido, não valor do contrato', () => {
    const lines = `
NOTA DE EMPRÉSTIMO
87863112
Número da Nota
1
Data de Liquidação 20/01/2026
Lado   Doador
Contrato:   2026010200930933340001-1
Papel:   PRIO3
Tipo do Contrato   OFERTA DOADORA
Valor do Contrato:   R$ 41.320,00
Qtd. Original:   1000
Remuneração:   R$ 0,72
Emolumentos:   R$ 0,00
I.R.R.F:   R$ 0,16
Corret. Execução:   R$ 0,15
Corret. Clearing:   R$ 0,10
Valor Líquido   R$ 0,31
Lado   Doador
Contrato:   2025122300927608720001-1
Papel:   PRIO3
Tipo do Contrato   OFERTA DOADORA
Valor do Contrato:   R$ 181.952,00
Qtd. Original:   4400
Valor Líquido   R$ 2,18
Resumo financeiro
Valor líquido   R$ 2,49
`.trim().split('\n');
    const notes = parseBtgBrokerageNoteBlocks(lines, 'LOAN/test.pdf', 'LOAN');
    expect(notes).toHaveLength(1);
    expect(notes[0].trades).toHaveLength(2);
    expect(notes[0].trades[0].grossValue).toBe(0.31);
    expect(notes[0].trades[1].grossValue).toBe(2.18);
    expect(notes[0].netOperations).toBe(2.49);
    expect(notes[0].trades[0].grossValue).not.toBe(41320);
  });

  it('locação só tomador: sem linhas de recebimento', () => {
    const lines = `
NOTA DE EMPRÉSTIMO
87993114
Número da Nota
1
Data de Liquidação 21/01/2026
Lado   Tomador
Papel:   PRIO3
Valor do Contrato:   R$ 22.145,00
Qtd. Original:   500
Valor Líquido   R$ -0,11
`.trim().split('\n');
    const notes = parseBtgBrokerageNoteBlocks(lines, 'LOAN/test.pdf', 'LOAN');
    expect(notes[0].trades).toHaveLength(0);
  });

  it('ticker colado ao maturity: separa corretamente (4 casos reais)', () => {
    const lines = `
NOTA DE CORRETAGEM
99000001
Nr. nota
1
Folha
22/05/2026
Data pregão
004176105
Negócios realizados
1-BOVESPA VOPCAO DE VENDA 01/26PRIOM385 ON 2500 0,16 400,00 C
1-BOVESPA VOPCAO DE COMPRA 02/26PRIOC405 ON 3000 1,23 3.690,00 C
1-BOVESPA VEXERC OPC VENDA 04/26PRIOP650E ON 4000 65,00 260.000,00 D
1-BOVESPA COPCAO DE COMPRA 03/26ITUBC42 ON 1200 1,23 1.476,00 D
Resumo dos Negócios
`.trim().split('\n');

    const notes = parseBtgBrokerageNoteBlocks(lines, 'OPTIONS/test.pdf', 'OPTIONS');
    expect(notes).toHaveLength(1);
    const [t0, t1, t2, t3] = notes[0].trades;

    // linha 1: VENDA opção PRIOM385
    expect(t0.ticker).toBe('PRIOM385');
    expect(t0.side).toBe('V');
    expect(t0.quantity).toBe(2500);
    expect(t0.unitPrice).toBe(0.16);
    expect(t0.maturity).toBe('01/26');
    expect(t0.isExercise).toBe(false);

    // linha 2: COMPRA opção PRIOC405
    expect(t1.ticker).toBe('PRIOC405');
    expect(t1.side).toBe('V');
    expect(t1.quantity).toBe(3000);
    expect(t1.unitPrice).toBe(1.23);
    expect(t1.maturity).toBe('02/26');
    expect(t1.isExercise).toBe(false);

    // linha 3: EXERC OPC VENDA PRIOP650E
    expect(t2.ticker).toBe('PRIOP650E');
    expect(t2.side).toBe('V');
    expect(t2.quantity).toBe(4000);
    expect(t2.unitPrice).toBe(65);
    expect(t2.maturity).toBe('04/26');
    expect(t2.isExercise).toBe(true);

    // linha 4: COMPRA opção ITUBC42
    expect(t3.ticker).toBe('ITUBC42');
    expect(t3.side).toBe('C');
    expect(t3.quantity).toBe(1200);
    expect(t3.unitPrice).toBe(1.23);
    expect(t3.maturity).toBe('03/26');
    expect(t3.isExercise).toBe(false);
  });

  it('dedupe remove nota repetida (abril)', () => {
    const { kept, skipped } = dedupeBrokerageNotes(
      parseBtgBrokerageNoteBlocks(SAMPLE, 'a.pdf', 'OPTIONS')
    );
    expect(kept).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].duplicateSkipped).toBe(true);
  });
});
