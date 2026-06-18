import { computeThreePricesByUnderlying } from '../../../src/core/invest/threePricesEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

let seq = 0;
const nextId = () => `e${++seq}`;

function buy(ticker: string, qty: number, price: number, date: string, costs = 0): LedgerEvent {
  const gross = qty * price;
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: 'stock',
    transaction_type: 'buy',
    transaction_date: date,
    quantity: qty,
    unit_price: price,
    total_net_value: -(gross + costs),
  };
}

function sell(ticker: string, qty: number, price: number, date: string): LedgerEvent {
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: 'stock',
    transaction_type: 'sell',
    transaction_date: date,
    quantity: -qty,
    unit_price: price,
    total_net_value: qty * price,
  };
}

function putSell(
  ticker: string,
  underlying: string,
  qty: number,
  premiumTotalNet: number,
  date: string
): LedgerEvent {
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: 'option_put',
    underlying_ticker: underlying,
    transaction_type: 'put_sell',
    transaction_date: date,
    quantity: -qty,
    unit_price: premiumTotalNet / qty,
    total_net_value: premiumTotalNet,
  };
}

function putBuy(
  ticker: string,
  underlying: string,
  qty: number,
  premiumTotalPaid: number,
  date: string
): LedgerEvent {
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: 'option_put',
    underlying_ticker: underlying,
    transaction_type: 'put_buy',
    transaction_date: date,
    quantity: qty,
    unit_price: premiumTotalPaid / qty,
    total_net_value: -premiumTotalPaid,
  };
}

function callSell(
  ticker: string,
  underlying: string,
  qty: number,
  premiumTotalNet: number,
  date: string
): LedgerEvent {
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: 'option_call',
    underlying_ticker: underlying,
    transaction_type: 'call_sell',
    transaction_date: date,
    quantity: -qty,
    unit_price: premiumTotalNet / qty,
    total_net_value: premiumTotalNet,
  };
}

function callBuy(
  ticker: string,
  underlying: string,
  qty: number,
  premiumTotalPaid: number,
  date: string
): LedgerEvent {
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: 'option_call',
    underlying_ticker: underlying,
    transaction_type: 'call_buy',
    transaction_date: date,
    quantity: qty,
    unit_price: premiumTotalPaid / qty,
    total_net_value: -premiumTotalPaid,
  };
}

function optionExercise(
  ticker: string,
  underlying: string,
  qty: number,
  strike: number,
  isPut: boolean,
  date: string,
  netPremium = 0
): LedgerEvent {
  return {
    id: nextId(),
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: isPut ? 'option_put' : 'option_call',
    underlying_ticker: underlying,
    transaction_type: 'option_exercise',
    transaction_date: date,
    quantity: qty,
    unit_price: strike,
    total_net_value: netPremium,
  };
}

/** Par realista BTG: lançamento de exercício de PUT vendida = buy(ação) + option_exercise(opção, net=prêmio). */
function putExerciseBuyShares(
  optionTicker: string,
  underlying: string,
  qty: number,
  strike: number,
  premiumNet: number,
  date: string
): LedgerEvent[] {
  return [
    buy(underlying, qty, strike, date),
    optionExercise(optionTicker, underlying, qty, strike, true, date, premiumNet),
  ];
}

/** Par realista BTG: exercício de CALL comprada = buy(ação) + option_exercise(opção, net=−prêmio_pago). */
function callExerciseBuyShares(
  optionTicker: string,
  underlying: string,
  qty: number,
  strike: number,
  premiumPaid: number,
  date: string
): LedgerEvent[] {
  return [
    buy(underlying, qty, strike, date),
    optionExercise(optionTicker, underlying, qty, strike, false, date, -premiumPaid),
  ];
}

beforeEach(() => {
  seq = 0;
});

const mockOptions = {
  ctx: {
    isStockLike: (type: string) => type === 'stock' || type === 'fii',
    isOptionLike: (type: string) => type === 'option_call' || type === 'option_put',
    isIgnoredAssetType: (type: string) => type === 'cash' || type === 'fixed_income',
    isIgnoredTransaction: (type: string) => 
      ['dividend', 'jcp', 'cash_yield', 'securities_lending', 'capital_deposit', 
       'capital_withdrawal', 'penalty_b3', 'fee', 'revaluation', 'pending_settlement'].includes(type)
  }
};

const runEngine = (entries: LedgerEvent[], asOfDate?: string) => 
  computeThreePricesByUnderlying(entries, mockOptions, asOfDate);

describe('threePricesEngine', () => {
  it('abertura com unit_price zerado usa total_net_value', () => {
    const out = runEngine([
      {
        id: nextId(),
        asset_id: 'ITUB4',
        asset_ticker: 'ITUB4',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-02',
        quantity: 500,
        unit_price: 0,
        total_net_value: -18200,
      },
    ]);
    const p = out.get('ITUB4')!;
    expect(p.qty).toBe(500);
    expect(p.estrito).toBeCloseTo(36.4, 2);
    expect(p.b3).toBeCloseTo(36.4, 2);
  });

  it('compra simples — três preços iguais', () => {
    const out = runEngine([buy('PRIO3', 100, 40, '2026-01-10')]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBe(40);
    expect(p.lotStart).toBe('2026-01-10');
  });

  it('compra incorpora emolumentos/taxas no Estrito', () => {
    const out = runEngine([buy('PRIO3', 100, 40, '2026-01-10', 5)]);
    const p = out.get('PRIO3')!;
    expect(p.estrito).toBeCloseTo((100 * 40 + 5) / 100, 4);
  });

  it('ignora renda fixa no calculo de tres precos de acoes/opcoes', () => {
    const out = runEngine([
      {
        id: nextId(),
        asset_id: 'LFT-20310301',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'buy',
        transaction_date: '2026-01-10',
        quantity: 1,
        unit_price: 15000,
        total_net_value: -15000,
      },
      buy('PRIO3', 100, 40, '2026-01-10'),
    ]);
    expect(out.has('LFT-20310301')).toBe(false);
    expect(out.get('PRIO3')?.estrito).toBe(40);
  });

  it('duas compras — média ponderada', () => {
    const out = runEngine([
      buy('PRIO3', 100, 40, '2026-01-10'),
      buy('PRIO3', 100, 50, '2026-02-10'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(200);
    expect(p.estrito).toBe(45);
    expect(p.b3).toBe(45);
    expect(p.gerencial).toBe(45);
  });

  it('asOfDate ignora eventos futuros', () => {
    const out = runEngine(
      [
        buy('PRIO3', 100, 40, '2026-01-10'),
        buy('PRIO3', 100, 50, '2026-02-10'),
      ],
      '2026-01-31'
    );
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBe(40);
  });

  it('venda parcial — Estrito e B3 constantes', () => {
    const out = runEngine([
      buy('PRIO3', 200, 40, '2026-01-10'),
      sell('PRIO3', 50, 60, '2026-02-15'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(150);
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBe(40);
  });

  it('Caso A: vendi PUT por R$ 10 + PUT exercida → 1000 ações ao strike R$ 1', () => {
    const out = runEngine([
      putSell('PRIOXYZ', 'PRIO3', 1000, 10, '2026-01-10'),
      ...putExerciseBuyShares('PRIOXYZ', 'PRIO3', 1000, 1, 10, '2026-02-20'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(1000);
    expect(p.estrito).toBeCloseTo(1, 4);
    expect(p.b3).toBeCloseTo(0.99, 4);
    expect(p.gerencial).toBeCloseTo(0.99, 4);
  });

  it('CALL comprada exercida: Estrito = strike + prêmio, B3 = strike + prêmio', () => {
    const out = runEngine([
      callBuy('STOCKA100', 'ACAO3', 100, 100, '2026-01-05'),
      buy('ACAO3', 100, 100, '2026-01-20', 0),
      optionExercise('STOCKA100', 'ACAO3', 100, 100, false, '2026-01-20', -100),
    ]);
    const p = out.get('ACAO3')!;
    expect(p.qty).toBe(100);
    expect(p.estrito).toBeCloseTo(101, 4);
    expect(p.b3).toBeCloseTo(101, 4);
  });

  it('exercício CALL: compra da ação com nota Exercício liga à série da call_buy', () => {
    const out = runEngine([
      callBuy('PRIOA100', 'PRIO3', 10, 10, '2026-01-05'),
      {
        id: nextId(),
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-20',
        quantity: 10,
        unit_price: 100,
        total_net_value: -1000,
        broker_note_ref: 'NOTA-123',
        notes: 'Exercício/atribuição — PRIOA100E',
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.b3).toBeCloseTo(101, 4);
  });

  it('Caso B: comprei CALL por R$ 10 + exerci → 1000 ações ao strike R$ 1', () => {
    const out = runEngine([
      callBuy('PRIOABC', 'PRIO3', 1000, 10, '2026-01-10'),
      ...callExerciseBuyShares('PRIOABC', 'PRIO3', 1000, 1, 10, '2026-02-20'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(1000);
    // Strike (1) + Premium (0.01)
    expect(p.estrito).toBeCloseTo(1.01, 4);
    expect(p.b3).toBeCloseTo(1.01, 4);
    expect(p.gerencial).toBeCloseTo(1.01, 4);
  });

  it('Caso C parcial: vendi 1000 PUT, recomprei 200, 600 das 800 exercidas', () => {
    const out = runEngine([
      // Compra inicial de 5000 ações ao strike R$ 50 para ter base
      buy('PRIO3', 5000, 50, '2026-01-05'),
      putSell('PRIOM50', 'PRIO3', 1000, 1000, '2026-01-10'),
      putBuy('PRIOM50', 'PRIO3', 200, 300, '2026-01-20'),
      // 600 PUTs exercidas — par BTG (buy + option_exercise sem net explícito,
      // fica com cálculo proporcional histórico).
      buy('PRIO3', 600, 50, '2026-02-15'),
      optionExercise('PRIOM50', 'PRIO3', 600, 50, true, '2026-02-15'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(5600);
    expect(p.estrito).toBeCloseTo(50, 4);
    // prêmio alocado proporcional = (600/800) × 700 = 525
    expect(p.b3).toBeCloseTo((5600 * 50 - 525) / 5600, 3);
    // gerencial: premioOpcoesPeriodo = 700
    expect(p.gerencial).toBeCloseTo((5600 * 50 - 700) / 5600, 3);
  });

  it('vendi 3 PUTs, 2 exercidas, 1 expira — Gerencial abate todas; B3 abate só as exercidas', () => {
    // 3 PUTs vendidas, prêmio total R$ 30. 2 exercidas = par buy + option_exercise (sem net).
    const out = runEngine([
      buy('TEST3', 100, 20, '2026-01-05'),
      putSell('TESTM20', 'TEST3', 3, 30, '2026-01-10'),
      buy('TEST3', 2, 20, '2026-02-15'),
      optionExercise('TESTM20', 'TEST3', 2, 20, true, '2026-02-15'),
    ]);
    const p = out.get('TEST3')!;
    expect(p.qty).toBe(102);
    expect(p.estrito).toBeCloseTo(20, 4);
    expect(p.b3).toBeCloseTo((102 * 20 - 20) / 102, 4);
    expect(p.gerencial).toBeCloseTo((102 * 20 - 30) / 102, 4);
  });

  it('vendi 5 CALLs, 1 exercida (saída), 4 expiram — Gerencial abate todas; B3 não muda do remanescente', () => {
    // qty inicial 500, vendo 5 CALLs (cobertas), 1 é exercida (vende 1 ação ao strike)
    const out = runEngine([
      buy('TEST3', 500, 20, '2026-01-05'),
      callSell('TESTA25', 'TEST3', 5, 50, '2026-01-10'),
      optionExercise('TESTA25', 'TEST3', 1, 25, false, '2026-02-15'),
    ]);
    const p = out.get('TEST3')!;
    // qty = 500 - 1 = 499
    expect(p.qty).toBe(499);
    // estrito = proporcional após venda → mantém 20
    expect(p.estrito).toBeCloseTo(20, 4);
    // B3: CALL vendida exercida = saída, não ajusta. Estrito - b3AjusteTotal proporcional.
    // b3AjusteTotal antes da venda = 0; depois da venda forçada de 1, ainda 0.
    // PM B3 = 20
    expect(p.b3).toBeCloseTo(20, 4);
    // Gerencial: premioOpcoesPeriodo = 50; qty = 499
    // PM Gerencial = (499 × 20 - 50) / 499
    expect(p.gerencial).toBeCloseTo((499 * 20 - 50) / 499, 2);
  });

  it('opções sem ação em carteira não entram nos 3 preços (só pivot); novo lote começa limpo', () => {
    const out = runEngine([
      putSell('PRIOM40', 'PRIO3', 10, 100, '2026-01-05'),
      callSell('PRIOA45', 'PRIO3', 5, 50, '2026-01-10'),
      buy('PRIO3', 100, 30, '2026-02-01'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    expect(p.estrito).toBe(30);
    expect(p.b3).toBe(30);
    expect(p.gerencial).toBe(30);
  });

  it('lote zera por venda total → próxima compra começa do zero', () => {
    const out = runEngine([
      buy('PRIO3', 100, 40, '2026-01-10'),
      putSell('PRIOXYZ', 'PRIO3', 100, 50, '2026-01-15'), // prêmio acumula
      sell('PRIO3', 100, 60, '2026-02-10'), // zera o lote
      buy('PRIO3', 200, 30, '2026-03-10'), // novo lote
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(200);
    expect(p.estrito).toBe(30);
    // Lote anterior foi zerado, gerencial NÃO carrega o prêmio antigo.
    expect(p.gerencial).toBe(30);
    expect(p.b3).toBe(30);
    expect(p.lotStart).toBe('2026-03-10');
  });

  it('reset não vaza estado por opção (séries são limpas)', () => {
    const out = runEngine([
      buy('PRIO3', 100, 40, '2026-01-10'),
      putSell('PRIOXYZ', 'PRIO3', 100, 50, '2026-01-15'),
      sell('PRIO3', 100, 60, '2026-02-10'), // lote zera
      buy('PRIO3', 100, 30, '2026-03-10'),
      // Tentativa de exercer a PUT antiga — não deveria afetar o novo lote
      optionExercise('PRIOXYZ', 'PRIO3', 100, 35, true, '2026-04-10'),
    ]);
    const p = out.get('PRIO3')!;
    // O exercício de uma PUT inexistente na série atual (premioLiquido = 0) é um no-op
    // para o ajuste B3, mas a engine vai considerar como "PUT vendida exercida" se
    // qtyAtualSerie = 0 não está short. Como série foi resetada, qtyAtualSerie = 0,
    // então a engine NÃO cai em nenhum ramo de exercício → no-op.
    expect(p.qty).toBe(100);
    expect(p.estrito).toBe(30);
    expect(p.b3).toBe(30);
    expect(p.gerencial).toBe(30);
  });

  it('dividendo, JCP e locação abatem só o Meu PM (Estrito e B3 inalterados)', () => {
    const out = runEngine([
      buy('PRIO3', 100, 40, '2026-01-10'),
      {
        id: 'd1',
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'dividend',
        transaction_date: '2026-02-15',
        quantity: 0,
        unit_price: 0,
        total_net_value: 200,
      },
      {
        id: 'j1',
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'jcp',
        transaction_date: '2026-02-20',
        quantity: 0,
        unit_price: 0,
        total_net_value: 50,
      },
      {
        id: 'sl1',
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'securities_lending',
        transaction_date: '2026-02-25',
        quantity: 0,
        unit_price: 0,
        total_net_value: 30,
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBeCloseTo((100 * 40 - 280) / 100, 4);
  });

  it('cenário do arquiteto (mês 2 + mês 3): PUT série A não exercida = não conta; PUT série B com parte exercida = toda conta', () => {
    const out = runEngine([
      putSell('PRIOMA1', 'PRIO3', 1000, 10, '2026-02-05'),
      putSell('PRIOMB1', 'PRIO3', 1000, 10, '2026-03-05'),
      buy('PRIO3', 500, 1, '2026-03-20'),
      optionExercise('PRIOMB1', 'PRIO3', 500, 1, true, '2026-03-20'),
    ]);

    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(500);
    expect(p.estrito).toBeCloseTo(1, 3);
    // B3: abate só o prêmio proporcional da parte exercida da série B → (500-5)/500 = 0.99
    expect(p.b3).toBeCloseTo(0.99, 3);
    // Gerencial: abate todo o prêmio da série B (R$ 10) porque uma da série foi exercida.
    expect(p.gerencial).toBeCloseTo(0.98, 3);
  });

  it('option_exercise é processado mesmo com impacts_managerial_price=false (engine calcula prêmio pelo histórico, flag legado não bloqueia)', () => {
    const out = runEngine([
      putSell('PRIOM40', 'PRIO3', 100, 200, '2026-01-05'),
      buy('PRIO3', 100, 40, '2026-02-15'),
      {
        id: 'opex1',
        asset_id: 'PRIOM40',
        asset_ticker: 'PRIOM40',
        asset_type: 'option_put',
        underlying_ticker: 'PRIO3',
        transaction_type: 'option_exercise',
        transaction_date: '2026-02-15',
        quantity: 100,
        unit_price: 40,
        total_net_value: 0,
        impacts_managerial_price: false,
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    // 100 ações × strike 40 = 4000; abate prêmio 200 → PM B3 = 38
    expect(p.b3).toBeCloseTo(38, 4);
  });

  it('PUT com underlying_ticker errado (ITUB3) casa no bucket ITUB4 com o exercício', () => {
    const out = runEngine([
      putSell('ITUBQ445', 'ITUB3', 900, 216, '2026-04-29'),
      {
        id: nextId(),
        asset_id: 'ITUB4',
        asset_ticker: 'ITUB4',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-05-15',
        quantity: 900,
        unit_price: 40.72,
        total_net_value: -(900 * 40.72),
        broker_note_ref: 'BTG-EXERCISE-2026-05-15#9#ITUBQ445E',
        notes: 'Exercício/atribuição — ITUBQ445E',
      },
    ]);
    const p = out.get('ITUB4')!;
    expect(p.qty).toBe(900);
    expect(p.estrito).toBeCloseTo(40.72, 2);
    expect(p.b3).toBeCloseTo((900 * 40.72 - 216) / 900, 2);
    expect(p.gerencial).toBeCloseTo((900 * 40.72 - 216) / 900, 2);
    expect(p.b3).toBeLessThan(p.estrito);
  });

  it('compra por exercício só no papel (BTG): Estrito = strike; B3 e Gerencial abatem prêmio da PUT', () => {
    const out = runEngine([
      putSell('ITUBQ413', 'ITUB4', 1200, 377, '2026-04-27'),
      putSell('ITUBQ413', 'ITUB4', 700, 252, '2026-04-29'),
      {
        id: nextId(),
        asset_id: 'ITUB4',
        asset_ticker: 'ITUB4',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-05-15',
        quantity: 1200,
        unit_price: 41.43,
        total_net_value: -(1200 * 41.43),
        broker_note_ref: 'BTG-EXERCISE-2026-05-15#8#ITUBQ413F',
        notes: 'Exercício/atribuição — ITUBQ413F',
      },
    ]);
    const p = out.get('ITUB4')!;
    expect(p.qty).toBe(1200);
    expect(p.estrito).toBeCloseTo(41.43, 2);
    expect(p.b3).toBeLessThan(p.estrito);
    expect(p.gerencial).toBeLessThan(p.b3);
    const premioTotal = 377 + 252;
    const b3Premio = (1200 / 1900) * premioTotal;
    expect(p.b3).toBeCloseTo((1200 * 41.43 - b3Premio) / 1200, 2);
    expect(p.gerencial).toBeCloseTo((1200 * 41.43 - premioTotal) / 1200, 2);
  });

  it('nota BTG ITUB4: exercício PUT com ref #9 abate prêmio no B3', () => {
    const out = runEngine([
      putSell('ITUBQ413', 'ITUB4', 1200, 377, '2026-04-27'),
      {
        id: nextId(),
        asset_id: 'ITUB4',
        asset_ticker: 'ITUB4',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-05-15',
        quantity: 1200,
        unit_price: 41.43,
        total_net_value: 49716,
        broker_note_ref: 'BTG-NOTA-99999#2026-05-15#9',
        notes: 'Exercício/atribuição — ITUBQ413E (Notas BTG 2026)',
      },
    ]);
    const p = out.get('ITUB4')!;
    expect(p.b3).toBeLessThan(p.estrito);
    expect(p.b3).toBeCloseTo((1200 * 41.43 - 377) / 1200, 2);
  });

  it('nota BTG (ref com índice de perna): compra por exercício de PUT abate prêmio no B3', () => {
    const out = runEngine([
      putSell('PRIOP620', 'PRIO3', 1000, 2100, '2026-03-25'),
      putSell('PRIOP640', 'PRIO3', 3000, 3510, '2026-03-31'),
      {
        id: nextId(),
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-04-17',
        quantity: 1000,
        unit_price: 62,
        total_net_value: 62000,
        broker_note_ref: 'BTG-NOTA-31444906#2026-04-17#4',
        notes: 'Exercício/atribuição — PRIOP620E (Notas BTG 2026 (conferência))',
      },
      {
        id: nextId(),
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-04-17',
        quantity: 3000,
        unit_price: 64,
        total_net_value: 192000,
        broker_note_ref: 'BTG-NOTA-31444906#2026-04-17#5',
        notes: 'Exercício/atribuição — PRIOP640E (Notas BTG 2026 (conferência))',
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(4000);
    expect(p.estrito).toBeCloseTo(63.5, 2);
    expect(p.b3).toBeLessThan(p.estrito);
    expect(p.b3).toBeCloseTo((4000 * 63.5 - 2100 - 3510) / 4000, 2);
    expect(p.gerencial).toBeCloseTo(p.b3, 4);
  });

  it('opening_balance de short herdado (total_net negativo) abate prêmio no gerencial', () => {
    const out = runEngine([
      {
        id: 'a-open-stock',
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 1000,
        unit_price: 40,
        total_net_value: 40000,
      },
      {
        id: 'b-open-put',
        asset_id: 'PRIOQ43',
        asset_ticker: 'PRIOQ43',
        asset_type: 'option_put',
        underlying_ticker: 'PRIO3',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 500,
        unit_price: 1.5,
        total_net_value: -750,
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(1000);
    expect(p.estrito).toBe(40);
    expect(p.gerencial).toBeLessThan(p.estrito);
  });

  it('operações de opção (put_sell/put_buy/etc.) com impacts=false são ignoradas — marcadores contábeis', () => {
    const out = runEngine([
      buy('PRIO3', 100, 40, '2026-01-10'),
      {
        id: 'p1',
        asset_id: 'PRIOM40',
        asset_ticker: 'PRIOM40',
        asset_type: 'option_put',
        underlying_ticker: 'PRIO3',
        transaction_type: 'put_sell',
        transaction_date: '2026-02-05',
        quantity: -100,
        unit_price: 2,
        total_net_value: 200,
        impacts_managerial_price: false,
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBe(40);
  });

  it('amortization deve abater apenas do PM Estrito, travado em 0', () => {
    const out = runEngine([
      buy('FII11', 100, 100, '2026-01-10'),
      {
        id: 'a1',
        asset_id: 'FII11',
        asset_ticker: 'FII11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-02-15',
        quantity: 0,
        unit_price: 10,
        total_net_value: 1000,
      },
    ]);
    const p = out.get('FII11')!;
    expect(p.qty).toBe(100);
    // (100 * 100 - 1000) / 100 = 90
    expect(p.estrito).toBe(90);
    expect(p.b3).toBe(90); // como b3AjusteTotal é 0, estrito == b3
  });

  it('cost_adjustment deve somar no PM Estrito — ambos sobem o Estrito', () => {
    const out = runEngine([
      buy('PRIO3', 100, 40, '2026-01-10'),
      {
        id: 'ca1',
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'cost_adjustment',
        transaction_date: '2026-02-15',
        quantity: 0,
        unit_price: 100, // Custo de 100 reais
        total_net_value: -100,
      },
      {
        id: 'ca2',
        asset_id: 'PRIO3',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'cost_adjustment',
        transaction_date: '2026-03-15',
        quantity: 0,
        unit_price: 50,
        total_net_value: -50,
        metadata: { applies_to_b3: true },
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    // 4000 + 100 + 50 = 4150 -> 41.5
    expect(p.estrito).toBe(41.5);
    // B3 Ajuste = 100
    // PM B3 = (4150 - 100) / 100 = 4050 / 100 = 40.5
    expect(p.b3).toBe(40.5);
  });
});
