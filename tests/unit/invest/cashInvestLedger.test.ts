import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';
import {
  cashBalanceFromLedger,
  resolveCashInvestDisplayBalance,
  settledCashBalanceFromLedger,
} from '../../../src/core/invest/cashInvestLedger';
import { AUTO_D2_REF_PREFIX } from '../../../src/core/invest/AutoPendingSettlementSync';

describe('cashInvestLedger', () => {
  it('saldo caixa = soma total_net_value (não qty×preço)', () => {
    const entries = [
      {
        asset_id: 'cash1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'capital_deposit',
        quantity: 0,
        unit_price: 0,
        total_net_value: 456_000,
        transaction_date: '2026-05-18',
      },
      {
        asset_id: 'cash1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: -453_223.65,
        transaction_date: '2026-05-19',
      },
    ];
    const balance = cashBalanceFromLedger(entries, '2026-05-19');
    expect(balance).toBeCloseTo(2_776.35, 0);

    const { assets } = rebuildCustodyFromLedger(entries);
    const cash = assets.find((a) => a.ticker === 'CAIXA-BTG');
    expect(cash?.quantity).toBeCloseTo(balance, 0);
  });

  it('saldo exibido = livro razão (sem âncora externa)', () => {
    const entries = [
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 0,
        unit_price: 0,
        total_net_value: 10_000,
        transaction_date: '2026-01-01',
      },
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: -2_500,
        transaction_date: '2026-02-10',
      },
    ];
    expect(resolveCashInvestDisplayBalance(entries, '2026-02-10')).toBeCloseTo(7_500, 2);
  });

  it('ignora saldo inicial manual duplicado quando já há BTG-EXTRATO-OPENING', () => {
    const entries = [
      {
        id: 'c1',
        asset_id: 'c1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 0,
        unit_price: 0,
        total_net_value: 449_963.32,
        transaction_date: '2026-01-02',
        broker_note_ref: 'MANUAL-OPENING',
      },
      {
        id: 'c2',
        asset_id: 'c2',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 0,
        unit_price: 0,
        total_net_value: 449_963.32,
        transaction_date: '2026-01-02',
        broker_note_ref: 'BTG-EXTRATO-OPENING-2026-01',
      },
      {
        id: 'c3',
        asset_id: 'c3',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: -100,
        transaction_date: '2026-05-20',
      },
    ];
    expect(cashBalanceFromLedger(entries, '2026-05-20')).toBeCloseTo(449_863.32, 2);
  });

  it('lançamentos posteriores à data de corte são ignorados', () => {
    const entries = [
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'capital_deposit',
        quantity: 0,
        unit_price: 0,
        total_net_value: 1_000,
        transaction_date: '2026-03-01',
      },
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'capital_deposit',
        quantity: 0,
        unit_price: 0,
        total_net_value: 5_000,
        transaction_date: '2026-04-01',
      },
    ];
    expect(cashBalanceFromLedger(entries, '2026-03-15')).toBeCloseTo(1_000, 2);
  });

  it('saldo exibido incorpora pending vencido na data de liquidacao', () => {
    const tradeId = 'trade-stock-1';
    const entries = [
      {
        id: tradeId,
        asset_id: 'a-prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
        transaction_date: '2026-05-12',
      },
      {
        id: 'cash-pending',
        asset_id: 'a-caixa',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: -4000,
        transaction_date: '2026-05-12',
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}`,
      },
      {
        id: 'cash-pending-clear',
        asset_id: 'a-caixa',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: 4000,
        transaction_date: '2026-05-14',
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}:CLEAR`,
      },
    ];

    expect(resolveCashInvestDisplayBalance(entries, '2026-05-12')).toBeCloseTo(0, 2);
    expect(resolveCashInvestDisplayBalance(entries, '2026-05-14')).toBeCloseTo(-4000, 2);
  });

  const cashLeg = (o: {
    id: string;
    type: string;
    value: number;
    date: string;
    ref?: string;
    eventId?: string;
    notes?: string;
  }) => ({
    id: o.id,
    asset_id: o.id,
    asset_ticker: 'CAIXA-BTG',
    asset_type: 'cash',
    transaction_type: o.type,
    quantity: 0,
    unit_price: 0,
    total_net_value: o.value,
    transaction_date: o.date,
    broker_note_ref: o.ref,
    business_event_id: o.eventId,
    notes: o.notes,
  });

  it('opcao: pending da nota + capital_deposit do extrato (mesmo evento) conta o caixa uma vez', () => {
    const eventId = 'evt-opt-venda';
    const entries = [
      cashLeg({ id: 'open', type: 'opening_balance', value: 1_000, date: '2026-01-01' }),
      cashLeg({
        id: 'note-premio',
        type: 'pending_settlement',
        value: 400,
        date: '2026-01-05',
        ref: 'B3-NOTA-27421483#2026-01-05#1',
        eventId,
      }),
      cashLeg({
        id: 'note-fee',
        type: 'pending_settlement',
        value: -0.52,
        date: '2026-01-05',
        ref: 'B3-NOTA-27421483#2026-01-05#1#FEE-EMOL',
        eventId,
      }),
      cashLeg({
        id: 'ext-liq',
        type: 'capital_deposit',
        value: 399.48,
        date: '2026-01-06',
        ref: 'BTG-EXT-2026-01-06#01#B3-NOTA-27421483#1',
        eventId,
        notes: 'LIQ BOLSA',
      }),
    ];
    // Extrato e a verdade: abertura 1000 + 399,48 do extrato. O pending da nota (400 - 0,52)
    // e so transito e nao pode somar por cima (senao daria ~1799).
    expect(settledCashBalanceFromLedger(entries, '2026-01-31')).toBeCloseTo(1_399.48, 2);
  });

  it('tesouro: AUTO-D2 (transito) + buy do extrato (mesmo evento) nao dobra a saida', () => {
    const eventId = 'evt-tesouro-compra';
    const entries = [
      cashLeg({ id: 'open', type: 'opening_balance', value: 200_000, date: '2026-01-01' }),
      cashLeg({
        id: 'auto-open',
        type: 'pending_settlement',
        value: -54_160.08,
        date: '2026-01-09',
        ref: `${AUTO_D2_REF_PREFIX}fin-leg-1`,
        eventId,
      }),
      cashLeg({
        id: 'auto-clear',
        type: 'pending_settlement',
        value: 54_160.08,
        date: '2026-01-12',
        ref: `${AUTO_D2_REF_PREFIX}fin-leg-1:CLEAR`,
        eventId,
      }),
      cashLeg({
        id: 'ext-buy',
        type: 'buy',
        value: -54_160.08,
        date: '2026-01-12',
        ref: 'BTG-EXT-2026-01-09#01',
        eventId,
      }),
    ];
    // Compra debita o caixa uma vez (-54.160,08). A baixa AUTO-D2 nao soma por cima
    // (senao daria ~91.679 — saida dobrada).
    expect(settledCashBalanceFromLedger(entries, '2026-01-31')).toBeCloseTo(145_839.92, 2);
  });

  it('AUTO-D2 sem perna realizada do extrato: baixa do transito ainda conta', () => {
    const entries = [
      cashLeg({ id: 'open', type: 'opening_balance', value: 10_000, date: '2026-01-01' }),
      cashLeg({
        id: 'auto-open',
        type: 'pending_settlement',
        value: -4_000,
        date: '2026-01-05',
        ref: `${AUTO_D2_REF_PREFIX}só-transito`,
        eventId: 'evt-sem-extrato',
      }),
      cashLeg({
        id: 'auto-clear',
        type: 'pending_settlement',
        value: 4_000,
        date: '2026-01-07',
        ref: `${AUTO_D2_REF_PREFIX}só-transito:CLEAR`,
        eventId: 'evt-sem-extrato',
      }),
    ];
    // Sem perna realizada do extrato, o trânsito AUTO-D2 é o único registro: conta -4000.
    expect(settledCashBalanceFromLedger(entries, '2026-01-31')).toBeCloseTo(6_000, 2);
  });
});
