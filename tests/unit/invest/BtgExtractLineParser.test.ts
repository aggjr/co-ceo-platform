import {
  btgLinesToImportEntries,
  classifyBtgDescription,
  parseBtgMovementLine,
  parseBrNumber,
  getBtgOperationSign,
} from '../../../src/core/invest/BtgExtractLineParser';

describe('BtgExtractLineParser', () => {
  it('parseBrNumber', () => {
    expect(parseBrNumber('58.758,79')).toBeCloseTo(58758.79);
    expect(parseBrNumber('-128.599,23')).toBeCloseTo(-128599.23);
  });

  it('parseBtgMovementLine with balance delta', () => {
    const row = parseBtgMovementLine(
      '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27 399,48',
      58758.79
    );
    expect(row?.date).toBe('2026-01-06');
    expect(row?.signedCash).toBeCloseTo(399.48);
  });

  it('skips aggregated bolsa liquidation', () => {
    expect(
      classifyBtgDescription('LIQ BOLSA (Operacoes)- Pregão:05/01/2026').skip
    ).toBe(true);
  });

  it('maps tesouro compra', () => {
    const map = classifyBtgDescription('Compra de Tesouro Direto: LFT 01/03/2031');
    expect(map.operation).toBe('buy');
    expect(map.ticker).toBe('LFT-20310301');
  });

  it('btgLinesToImportEntries ignores LIQ BOLSA operacoes', () => {
    const entries = btgLinesToImportEntries(
      [
        'Saldo Inicial 58.758,79',
        '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27\t399,48',
        '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031 54.160,08\t6.795,79',
      ],
      58758.79
    );
    expect(entries.some((e) => e.operation === 'buy' && e.ticker === 'LFT-20310301')).toBe(
      true
    );
    expect(entries.some((e) => e.notes?.includes('LIQ BOLSA (Operacoes)'))).toBe(false);
  });

  it('getBtgOperationSign maps correctly', () => {
    expect(getBtgOperationSign('cash_yield', 'Rendimento Disponível')).toBe(1);
    expect(getBtgOperationSign('capital_withdrawal', 'TED ENVIADA')).toBe(-1);
    expect(getBtgOperationSign('securities_lending', 'TAXA REMUNERAÇÃO - BTC PRIO3')).toBe(1);
    expect(getBtgOperationSign('securities_lending', 'TAXA EMOLUMENTOS - BTC PRIO3')).toBe(-1);
    expect(getBtgOperationSign('fee', 'REEMBOLSO DE CUSTÓDIA')).toBe(1);
    expect(getBtgOperationSign('fee', 'CUSTÓDIA')).toBe(-1);
  });

  it('btgLinesToImportEntries calculates correct cash yield amount without delta bug', () => {
    const entries = btgLinesToImportEntries(
      [
        'Saldo Inicial 963.975,75',
        '30/04/2026 Rendimento Disponível - Saldo Remunerado 28.386,27\t0,25',
      ],
      963975.75
    );
    const yieldEntry = entries.find((e) => e.operation === 'cash_yield');
    expect(yieldEntry).toBeDefined();
    expect(yieldEntry?.total_net_value).toBeCloseTo(0.25);
  });
});
