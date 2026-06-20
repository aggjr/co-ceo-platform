import {
  btgLinesToImportEntries,
  classifyBtgDescription,
  dedupeLiqBolsaExtractEntries,
  parseBtgMovementLine,
  parseBrNumber,
  getBtgOperationSign,
} from '../../../src/core/invest/BtgExtractLineParser';
import { buildBtgExtractResolvers } from '../../../src/core/invest/buildBtgExtractResolvers';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

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

  it('parseBtgMovementLine resolves reversed PDF amounts using previous balance', () => {
    const row = parseBtgMovementLine(
      '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031 54.160,08 6.795,79',
      60955.87
    );
    expect(row?.balance).toBeCloseTo(6795.79);
    expect(row?.movementAmount).toBeCloseTo(54160.08);
    expect(row?.signedCash).toBeCloseTo(-54160.08);
  });

  it('parseBtgMovementLine LIQ operacoes usa coluna credito quando saldo acumulado diverge', () => {
    const row = parseBtgMovementLine(
      '28/01/2026 LIQ BOLSA (Operacoes)- Pregão:27/01/2026 2.016,50 1.997,32',
      52557.07
    );
    expect(row?.signedCash).toBeCloseTo(1997.32);
    expect(row?.balance).toBeCloseTo(2016.5);
  });

  it('skips aggregated bolsa liquidation mas classifica custodia LIQ como fee', () => {
    expect(
      classifyBtgDescription('LIQ BOLSA (Operacoes)- Pregão:05/01/2026').skip
    ).toBe(true);
    const custody = classifyBtgDescription('LIQ BOLSA (TAXA SOBRE VALOR EM CUSTÓDIA TAXA');
    expect(custody.skip).toBeFalsy();
    expect(custody.operation).toBe('fee');
  });

  it('maps conta remunerada resgate como cash_yield', () => {
    const map = classifyBtgDescription('CONTA REMUNERADA - RESGATE REMUNERAÇÃO -');
    expect(map.operation).toBe('cash_yield');
    expect(map.skip).toBeFalsy();
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

  it('includeLiqBolsa preserva valor assinado sem transformar em aporte', () => {
    const entries = btgLinesToImportEntries(
      [
        'Saldo Inicial 58.758,79',
        '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27\t399,48',
      ],
      58758.79,
      undefined,
      { includeLiqBolsa: true }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.operation).toBe('pending_settlement');
    expect(entries[0]!.total_net_value).toBeCloseTo(399.48, 2);
    expect(['capital_deposit', 'capital_withdrawal']).not.toContain(entries[0]!.operation);
  });

  it('dedupeLiqBolsaExtractEntries remove LIQ duplicado no mesmo dia/valor', () => {
    const entries = btgLinesToImportEntries(
      [
        'Saldo Inicial 58.758,79',
        '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27\t399,48',
        '06/01/2026 LIQ BOLSA (Operacoes)- Pregão:05/01/2026 59.158,27\t399,48',
      ],
      58758.79,
      undefined,
      { includeLiqBolsa: true }
    );
    expect(entries).toHaveLength(1);
    expect(dedupeLiqBolsaExtractEntries(entries)).toHaveLength(1);
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

    it('compra de TD sem tabela de PU nao cria quantidade ficticia', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 60.955,87',
          '09/01/2026 Compra de Tesouro Direto: LFT 01/03/2031 54.160,08\t6.795,79',
        ],
        60955.87
      );
      const buy = entries.find((e) => e.operation === 'buy');
      expect(buy?.quantity).toBe(0);
      expect(buy?.unit_price).toBe(0);
      expect(buy?.total_net_value).toBeCloseTo(-54160.08, 4);
      expect(buy?.impacts_managerial_price).toBe(false);
    });

    it('usa a tabela de movimentacao TD do PDF para quantidade e PU reais', () => {
      const entries = btgLinesToImportEntries(
        [
          'LFT   08/01/25   01/03/31   Não   -   -   SELIC + 0,10%   33,00   18.823,200000   621.165,56   7.272,95   -   613.892,61',
          '22/04/26',
          'BACEN-BANCO CENTRAL DO BRASIL - RJ /',
          'LFT',
          'VENDA DEFINITIVA   25   18.759,450000   468.986,25   7.618,65   -   461.367,60',
          'Saldo Inicial 38.275,33',
          '22/04/2026 VENDA DE TESOURO DIRETO: LFT 01/03/2031 -307.892,70\t468.986,25',
        ],
        -776878.95
      );
      const sell = entries.find((e) => e.operation === 'sell');
      expect(sell?.ticker).toBe('LFT-20310301');
      expect(sell?.quantity).toBeCloseTo(25, 6);
      expect(sell?.unit_price).toBeCloseTo(18759.45, 6);
      expect(sell?.total_net_value).toBeCloseTo(468986.25, 2);
      expect(sell?.impacts_managerial_price).toBeUndefined();
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

    it('Custodia generica com posicoes abertas rateia cost_adjustment por valor em custodia', () => {
      const ledger: LedgerEvent[] = [
        {
          asset_id: 'o1',
          transaction_date: '2026-01-01',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'opening_balance',
          quantity: 5400,
          unit_price: 40,
          total_net_value: 216_000,
        } as LedgerEvent,
        {
          asset_id: 'o2',
          transaction_date: '2026-01-01',
          asset_ticker: 'LFT-20310301',
          asset_type: 'fixed_income',
          transaction_type: 'opening_balance',
          quantity: 58,
          unit_price: 17_809.83,
          total_net_value: 1_032_969.97,
        } as LedgerEvent,
      ];
      const resolvers = buildBtgExtractResolvers(ledger);
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '31/03/2026 Taxa de Custódia 99.990,00\t10,00',
        ],
        100000,
        resolvers
      );
      const adjustments = entries.filter((e) => e.operation === 'cost_adjustment');
      expect(adjustments.length).toBe(2);
      expect(adjustments.every((e) => e.event_source_ref === 'BTG-CUSTODIA-MENSAL:2026-03')).toBe(
        true
      );
      const sum = adjustments.reduce((s, e) => s + Number(e.total_net_value), 0);
      expect(sum).toBeCloseTo(-10, 2);
      expect(entries.some((e) => e.operation === 'fee')).toBe(false);
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

    it('ignora LIQ BOLSA (Corretagem BTC) — detalhe vem das notas', () => {
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '20/01/2026 LIQ BOLSA (Corretagem BTC Aluguel) 99.999,00\t1,00',
        ],
        100000
      );
      expect(entries.length).toBe(0);
    });

    it('LIQ BOLSA taxa custodia com posicoes rateia cost_adjustment (credito fica fee em caixa)', () => {
      const ledger: LedgerEvent[] = [
        {
          asset_id: 'o1',
          transaction_date: '2026-01-01',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'opening_balance',
          quantity: 5400,
          unit_price: 40,
          total_net_value: 216_000,
        } as LedgerEvent,
      ];
      const resolvers = buildBtgExtractResolvers(ledger);
      const charge = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '19/01/2026 LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA) 99.998,00\t2,00',
        ],
        100000,
        resolvers
      );
      expect(charge.filter((e) => e.operation === 'cost_adjustment')).toHaveLength(1);
      expect(charge.some((e) => e.operation === 'fee')).toBe(false);

      const credit = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '19/01/2026 LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA) 100.002,00\t2,00',
        ],
        100000,
        resolvers
      );
      expect(credit.some((e) => e.operation === 'fee')).toBe(true);
    });

    it('pareia cobranca e estorno custodia POS 1026 sem rateio (liquido zero)', () => {
      const ledger: LedgerEvent[] = [
        {
          asset_id: 'o1',
          transaction_date: '2026-01-01',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'opening_balance',
          quantity: 5400,
          unit_price: 40,
          total_net_value: 216_000,
        } as LedgerEvent,
      ];
      const resolvers = buildBtgExtractResolvers(ledger);
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '19/01/2026 LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA TAXA SOBRE POSICAO 1026) 99.998,28\t1,72',
          '19/01/2026 LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA ESTORNO DE TAXA SOBRE POSICAO 1026) 100.000,00\t1,72',
        ],
        100000,
        resolvers
      );
      expect(entries.filter((e) => e.operation === 'cost_adjustment')).toHaveLength(0);
      const net = entries.find((e) => e.event_source_ref?.startsWith('BTG-CUSTODIA-NET:'));
      expect(net).toBeDefined();
      expect(net?.total_net_value).toBe(0);
      expect(net?.extract_category).toBe(2);
    });

    it('reembolso custodia remunerada aluguel nao pareia com taxa POS 1026', () => {
      const ledger: LedgerEvent[] = [
        {
          asset_id: 'o1',
          transaction_date: '2026-01-01',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'opening_balance',
          quantity: 5400,
          unit_price: 40,
          total_net_value: 216_000,
        } as LedgerEvent,
      ];
      const resolvers = buildBtgExtractResolvers(ledger);
      const entries = btgLinesToImportEntries(
        [
          'Saldo Inicial 100.000,00',
          '19/01/2026 LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA TAXA SOBRE POSICAO 1026) 99.998,28\t1,72',
          '21/01/2026 REEMBOLSO DE CUSTODIA REMUNERADA - ALUGUEL 99.999,46\t1,18',
        ],
        100000,
        resolvers
      );
      expect(entries.filter((e) => e.event_source_ref?.startsWith('BTG-CUSTODIA-NET:'))).toHaveLength(
        0
      );
      expect(entries.filter((e) => e.operation === 'cost_adjustment')).toHaveLength(1);
      const reemb = entries.find((e) => e.operation === 'cash_yield');
      expect(reemb?.total_net_value).toBeCloseTo(1.18, 2);
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
