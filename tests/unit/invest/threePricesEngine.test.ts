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
  date: string
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
    total_net_value: 0,
  };
}

beforeEach(() => {
  seq = 0;
});

describe('threePricesEngine', () => {
  it('compra simples — três preços iguais', () => {
    const out = computeThreePricesByUnderlying([buy('PRIO3', 100, 40, '2026-01-10')]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBe(40);
    expect(p.lotStart).toBe('2026-01-10');
  });

  it('compra incorpora emolumentos/taxas no Estrito', () => {
    const out = computeThreePricesByUnderlying([buy('PRIO3', 100, 40, '2026-01-10', 5)]);
    const p = out.get('PRIO3')!;
    expect(p.estrito).toBeCloseTo((100 * 40 + 5) / 100, 4);
  });

  it('duas compras — média ponderada', () => {
    const out = computeThreePricesByUnderlying([
      buy('PRIO3', 100, 40, '2026-01-10'),
      buy('PRIO3', 100, 50, '2026-02-10'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(200);
    expect(p.estrito).toBe(45);
    expect(p.b3).toBe(45);
    expect(p.gerencial).toBe(45);
  });

  it('venda parcial — Estrito e B3 constantes', () => {
    const out = computeThreePricesByUnderlying([
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
    const out = computeThreePricesByUnderlying([
      putSell('PRIOXYZ', 'PRIO3', 1000, 10, '2026-01-10'),
      optionExercise('PRIOXYZ', 'PRIO3', 1000, 1, true, '2026-02-20'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(1000);
    expect(p.estrito).toBeCloseTo(1, 4);
    expect(p.b3).toBeCloseTo(0.99, 4);
    expect(p.gerencial).toBeCloseTo(0.99, 4);
  });

  it('Caso B: comprei CALL por R$ 10 + exerci → 1000 ações ao strike R$ 1', () => {
    const out = computeThreePricesByUnderlying([
      callBuy('PRIOABC', 'PRIO3', 1000, 10, '2026-01-10'),
      optionExercise('PRIOABC', 'PRIO3', 1000, 1, false, '2026-02-20'),
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(1000);
    expect(p.estrito).toBeCloseTo(1, 4);
    expect(p.b3).toBeCloseTo(1.01, 4);
    expect(p.gerencial).toBeCloseTo(1.01, 4);
  });

  it('Caso C parcial: vendi 1000 PUT, recomprei 200, 600 das 800 exercidas', () => {
    const out = computeThreePricesByUnderlying([
      // Compra inicial de 5000 ações ao strike R$ 50 para ter base
      buy('PRIO3', 5000, 50, '2026-01-05'),
      putSell('PRIOM50', 'PRIO3', 1000, 1000, '2026-01-10'),
      putBuy('PRIOM50', 'PRIO3', 200, 300, '2026-01-20'),
      optionExercise('PRIOM50', 'PRIO3', 600, 50, true, '2026-02-15'),
    ]);
    const p = out.get('PRIO3')!;
    // qty = 5000 + 600 = 5600
    expect(p.qty).toBe(5600);
    // estrito = (5000 × 50 + 600 × 50) / 5600 = 50
    expect(p.estrito).toBeCloseTo(50, 4);
    // prêmio alocado = (600/800) × 700 = 525
    // b3AjusteTotal = 525 (positivo: PUT vendida exercida)
    // PM B3 = (5600 × 50 - 525) / 5600 = 49.90625
    expect(p.b3).toBeCloseTo((5600 * 50 - 525) / 5600, 3);
    // gerencial: premioOpcoesPeriodo = 1000 - 300 = 700
    // PM Gerencial = (5600 × 50 - 700) / 5600
    expect(p.gerencial).toBeCloseTo((5600 * 50 - 700) / 5600, 3);
  });

  it('vendi 3 PUTs, 2 exercidas, 1 expira — Gerencial abate todas; B3 abate só as exercidas', () => {
    // PUT série única, qty 3 unidades, prêmio total R$ 30 (R$ 10/PUT)
    const out = computeThreePricesByUnderlying([
      buy('TEST3', 100, 20, '2026-01-05'),
      putSell('TESTM20', 'TEST3', 3, 30, '2026-01-10'),
      optionExercise('TESTM20', 'TEST3', 2, 20, true, '2026-02-15'),
      // A PUT remanescente (1) expira: no banco isso é um lançamento `expired` ou simplesmente
      // não tem mais lançamento. A engine não precisa de um evento explícito de expiração —
      // ela só sabe que ficou prêmio reservado.
    ]);
    const p = out.get('TEST3')!;
    // qty = 100 + 2 = 102
    expect(p.qty).toBe(102);
    // estrito = (100 × 20 + 2 × 20) / 102 = 20
    expect(p.estrito).toBeCloseTo(20, 4);
    // prêmio alocado às 2 exercidas = (2/3) × 30 = 20
    // PM B3 = (102 × 20 - 20) / 102 = 19.8039
    expect(p.b3).toBeCloseTo((102 * 20 - 20) / 102, 4);
    // Gerencial: premioOpcoesPeriodo = 30 (todas as 3 vendidas)
    // PM Gerencial = (102 × 20 - 30) / 102
    expect(p.gerencial).toBeCloseTo((102 * 20 - 30) / 102, 4);
  });

  it('vendi 5 CALLs, 1 exercida (saída), 4 expiram — Gerencial abate todas; B3 não muda do remanescente', () => {
    // qty inicial 500, vendo 5 CALLs (cobertas), 1 é exercida (vende 1 ação ao strike)
    const out = computeThreePricesByUnderlying([
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
    expect(p.gerencial).toBeCloseTo((499 * 20 - 50) / 499, 4);
  });

  it('lote zera por venda total → próxima compra começa do zero', () => {
    const out = computeThreePricesByUnderlying([
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
    const out = computeThreePricesByUnderlying([
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

  it('dividendo, JCP, locação são ignorados — não afetam PM', () => {
    const out = computeThreePricesByUnderlying([
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
    ]);
    const p = out.get('PRIO3')!;
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
    expect(p.gerencial).toBe(40);
  });

  it('cenário do arquiteto (mês 2 + mês 3): PUT série A não exercida = não conta; PUT série B com parte exercida = toda conta', () => {
    const out = computeThreePricesByUnderlying([
      // Mês 2: vendi 1 PUT (série A) por R$ 10 cobrindo 1000 ações @ R$ 1, mas a PUT não foi exercida.
      // Não há ledger event de "expiração" — a engine só nunca vê exercício, então a série some.
      putSell('PRIOMA1', 'PRIO3', 1000, 10, '2026-02-05'),

      // Mês 3: vendo 2 PUTs da série B (500 cada @ R$ 0,01 = R$ 5 cada, total +R$ 10) cobrindo 500 cada ao strike R$ 1.
      putSell('PRIOMB1', 'PRIO3', 1000, 10, '2026-03-05'),

      // Só uma PUT (500 unidades) da série B é exercida.
      optionExercise('PRIOMB1', 'PRIO3', 500, 1, true, '2026-03-20'),
    ]);

    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(500);
    // Estrito: só preço da compra (strike R$ 1)
    expect(p.estrito).toBeCloseTo(1, 3);
    // B3: abate só o prêmio proporcional da parte exercida da série B → (500-5)/500 = 0.99
    expect(p.b3).toBeCloseTo(0.99, 3);
    // Gerencial: abate todo o prêmio da série B (R$ 10) porque uma da série foi exercida.
    // Série A não conta (nenhuma exercida). → (500-10)/500 = 0.98
    expect(p.gerencial).toBeCloseTo(0.98, 3);
  });

  it('eventos com impacts_managerial_price=false são ignorados', () => {
    const out = computeThreePricesByUnderlying([
      buy('PRIO3', 100, 40, '2026-01-10'),
      {
        id: 'opex1',
        asset_id: 'PRIOXYZ',
        asset_ticker: 'PRIOXYZ',
        asset_type: 'option_put',
        underlying_ticker: 'PRIO3',
        transaction_type: 'option_exercise',
        transaction_date: '2026-02-15',
        quantity: 100,
        unit_price: 40,
        total_net_value: 1000,
        impacts_managerial_price: false, // marcador contábil antigo, ignorar
      },
    ]);
    const p = out.get('PRIO3')!;
    expect(p.qty).toBe(100);
    expect(p.estrito).toBe(40);
    expect(p.b3).toBe(40);
  });
});
