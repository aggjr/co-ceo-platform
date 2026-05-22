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
    expect(yieldEntry?.extract_category).toBe(3);
  });

  describe('event_source_ref por categoria (Caminho 1B)', () => {
    it('compra de TD gera entry buy com event_source_ref BTG-TD:{date}:{ticker}', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 60.955,87',
          '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031 54.160,08\t6.795,79',
        ],
        60955.87
      );
      const buy = entries.find((e) => e.operation === 'buy');
      expect(buy).toBeDefined();
      expect(buy?.event_source_ref).toBe('BTG-TD:2026-01-09:LFT-20310301');
      expect(buy?.extract_category).toBe(1);
    });

    it('IRRF cobrado sobre TD vira cost_adjustment no LFT com mesmo event_source_ref da TD', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 60.955,87',
          '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031 54.160,08\t6.795,79',
          '10/01/2026 IRRF Cobrado sobre Operacao de Tesouro Direto 54.136,08\t24,00',
        ],
        60955.87
      );
      const buy = entries.find((e) => e.operation === 'buy');
      const adj = entries.find((e) => e.operation === 'cost_adjustment');
      expect(buy).toBeDefined();
      expect(adj).toBeDefined();
      expect(adj?.ticker).toBe('LFT-20310301');
      expect(adj?.unit_price).toBeCloseTo(24, 4);
      expect(adj?.total_net_value).toBeCloseTo(24, 4);
      expect(adj?.applies_to_b3).toBe(false);
      expect(adj?.event_source_ref).toBe(buy?.event_source_ref);
      expect(adj?.extract_category).toBe(1);
    });

    it('IR-BTC PRIO3 vira cost_adjustment em PRIO3 com header mensal BTG-BTC-PRIO3:{ym}', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '15/02/2026 IR - BTC PRIO3 99.985,00\t15,00',
        ],
        100000
      );
      const adj = entries.find((e) => e.operation === 'cost_adjustment');
      expect(adj).toBeDefined();
      expect(adj?.ticker).toBe('PRIO3');
      expect(adj?.underlying_ticker).toBe('PRIO3');
      expect(adj?.event_source_ref).toBe('BTG-BTC-PRIO3:2026-02');
      expect(adj?.applies_to_b3).toBe(false);
      expect(adj?.extract_category).toBe(1);
    });

    it('Remuneracao BTC PRIO3 vira securities_lending no mesmo header mensal', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '03/02/2026 Remuneração BTC PRIO3 100.050,00\t50,00',
          '15/02/2026 IR - BTC PRIO3 100.035,00\t15,00',
        ],
        100000
      );
      const income = entries.find((e) => e.operation === 'securities_lending');
      const adj = entries.find((e) => e.operation === 'cost_adjustment');
      expect(income?.event_source_ref).toBe('BTG-BTC-PRIO3:2026-02');
      expect(adj?.event_source_ref).toBe('BTG-BTC-PRIO3:2026-02');
    });

    it('Custodia generica sem ticker vai pro header mensal BTG-CUSTODIA-MENSAL:{ym}', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '31/03/2026 Taxa de Custódia 99.990,00\t10,00',
        ],
        100000
      );
      const fee = entries.find((e) => e.operation === 'fee');
      expect(fee).toBeDefined();
      expect(fee?.event_source_ref).toBe('BTG-CUSTODIA-MENSAL:2026-03');
      expect(fee?.extract_category).toBe(2);
    });

    it('Multa por saldo negativo vai como penalty_b3 avulso (sem event_source_ref por enquanto)', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '10/03/2026 Juros sobre Saldo Negativo 99.900,00\t100,00',
        ],
        100000
      );
      const pen = entries.find((e) => e.operation === 'penalty_b3');
      expect(pen).toBeDefined();
      expect(pen?.event_source_ref).toBeUndefined();
      expect(pen?.extract_category).toBe(3);
    });

    it('IRRF de opcao (sem ticker no extrato) vai pro header mensal BTG-IRRF-OPCAO-MENSAL:{ym}', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '18/03/2026 IRRF - Lei 11.033/04 - Opcao (Vendas) 99.985,00\t15,00',
          '19/03/2026 IRRF - Lei 11.033/04 - Opcao (Vendas) 99.975,00\t10,00',
          '28/04/2026 IRRF - Lei 11.033/04 - Opcao (Day Trade) 99.970,00\t5,00',
        ],
        100000
      );
      const irrf = entries.filter((e) => e.operation === 'fee');
      expect(irrf.length).toBe(3);
      expect(irrf[0]?.event_source_ref).toBe('BTG-IRRF-OPCAO-MENSAL:2026-03');
      expect(irrf[1]?.event_source_ref).toBe('BTG-IRRF-OPCAO-MENSAL:2026-03');
      expect(irrf[2]?.event_source_ref).toBe('BTG-IRRF-OPCAO-MENSAL:2026-04');
      expect(irrf.every((e) => e.extract_category === 1)).toBe(true);
    });

    it('LIQ BOLSA (Corretagem BTC Aluguel) vira cost_adjustment em PRIO3', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '20/01/2026 LIQ BOLSA (Corretagem BTC Aluguel) 99.999,00\t1,00',
        ],
        100000
      );
      const adj = entries.find((e) => e.operation === 'cost_adjustment');
      expect(adj).toBeDefined();
      expect(adj?.ticker).toBe('PRIO3');
      expect(adj?.event_source_ref).toBe('BTG-BTC-PRIO3:2026-01');
    });

    it('LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA) vai pro header mensal de custodia', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '19/01/2026 LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA) 99.998,00\t2,00',
        ],
        100000
      );
      const fee = entries.find((e) => e.operation === 'fee');
      expect(fee).toBeDefined();
      expect(fee?.event_source_ref).toBe('BTG-CUSTODIA-MENSAL:2026-01');
      expect(fee?.extract_category).toBe(2);
    });

    it('TED enviada/recebida sao cat 3 sem event_source_ref', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '05/01/2026 TED ENVIADA - Banco XPTO 90.000,00\t10.000,00',
        ],
        100000
      );
      const withdrawal = entries.find((e) => e.operation === 'capital_withdrawal');
      expect(withdrawal).toBeDefined();
      expect(withdrawal?.event_source_ref).toBeUndefined();
      expect(withdrawal?.extract_category).toBe(3);
    });
  });
});
