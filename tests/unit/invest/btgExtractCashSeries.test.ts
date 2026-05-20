import {
  extractMovementBlock,
  parseExtractCashSeries,
  listExtractTeds,
} from '../../../src/core/invest/btgExtractCashSeries';

const SAMPLE = `
Movimentação - Conta Corrente
Saldo Inicial 7.130,37
02/03/2026 LIQ BOLSA (Operacoes)- Pregão:27/02/2026 8.067,49	937,12
17/03/2026 TED ENVIADA - AUGUSTO GONCALVES GOMES 19.631,39	5.000,00
Total de Créditos
`;

describe('btgExtractCashSeries', () => {
  it('parses saldo inicial and movement balances including LIQ BOLSA', () => {
    const block = extractMovementBlock(SAMPLE);
    const series = parseExtractCashSeries(block, 7130.37);
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series[0]!.date).toBe('2026-03-02');
    expect(series[0]!.balance).toBe(8067.49);
    const ted = series.find((p) => p.description.includes('TED ENVIADA'));
    expect(ted?.balance).toBe(19631.39);
  });

  it('lists TED withdrawals as negative amounts', () => {
    const block = extractMovementBlock(SAMPLE);
    const series = parseExtractCashSeries(block, 7130.37);
    const teds = listExtractTeds(series);
    expect(teds).toHaveLength(1);
    expect(teds[0]!.amount).toBe(-5000);
  });
});
