import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  parseBrMoney,
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

  it('dedupe remove nota repetida (abril)', () => {
    const { kept, skipped } = dedupeBrokerageNotes(
      parseBtgBrokerageNoteBlocks(SAMPLE, 'a.pdf', 'OPTIONS')
    );
    expect(kept).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].duplicateSkipped).toBe(true);
  });
});
