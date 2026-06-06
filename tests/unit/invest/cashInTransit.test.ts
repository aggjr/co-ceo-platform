import { buildCashInTransitSummary } from '../../../src/core/invest/cashInTransit';
import { cashSettlementDate } from '../../../src/core/invest/settlementCalendar';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import { AUTO_D2_REF_PREFIX } from '../../../src/core/invest/AutoPendingSettlementSync';

describe('cashInTransit', () => {
  it('put_sell liquida D+1', () => {
    expect(cashSettlementDate('2026-05-12', 'option_put', 'put_sell', 'ITUBQ445')).toBe(
      '2026-05-13'
    );
  });

  it('ação compra D+2 entra em trânsito até liquidar', () => {
    const tradeId = 'trade-stock-1';
    const entries: LedgerEvent[] = [
      {
        id: tradeId,
        asset_id: 'a-prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-05-12',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      },
      {
        id: 'cash-open',
        asset_id: 'a-caixa',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: '2026-05-12',
        quantity: 0,
        unit_price: 0,
        total_net_value: -4000,
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}`,
        notes: 'Valor em trânsito',
      },
      {
        id: 'cash-clear',
        asset_id: 'a-caixa',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: '2026-05-14',
        quantity: 0,
        unit_price: 0,
        total_net_value: 4000,
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}:CLEAR`,
        notes: 'Baixa do transito',
      },
    ];
    const s = buildCashInTransitSummary(entries, '2026-05-12');
    expect(s.inTransitNet).toBe(-4000);
    expect(s.settledCashBalance).toBe(0);
    expect(s.lines.length).toBeGreaterThan(0);
    expect(s.lines[0]!.settleDate).toBe('2026-05-14');

    const settled = buildCashInTransitSummary(entries, '2026-05-14');
    expect(settled.inTransitNet).toBe(0);
    expect(settled.settledCashBalance).toBe(-4000);
    expect(settled.cashIncludingTransit).toBe(-4000);
  });

  it('previsão de compra com total_net positivo gera payable negativo', () => {
    const entries: LedgerEvent[] = [
      {
        id: 't1',
        asset_id: 'a-prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-05-12',
        quantity: 100,
        unit_price: 40,
        total_net_value: 4000,
      },
    ];
    const s = buildCashInTransitSummary(entries, '2026-05-12');
    expect(s.inTransitNet).toBe(-4000);
  });

  it('keeps overdue pending settlement open until clear leg exists', () => {
    const tradeId = 'trade-overdue-1';
    const entries: LedgerEvent[] = [
      {
        id: tradeId,
        asset_id: 'a-prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-05-12',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
      },
      {
        id: 'cash-open-overdue',
        asset_id: 'a-caixa',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: '2026-05-12',
        settlement_date: '2026-05-14',
        quantity: 0,
        unit_price: 0,
        total_net_value: -4000,
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}`,
        notes: 'Valor em transito',
      },
    ];

    const s = buildCashInTransitSummary(entries, '2026-05-20');

    expect(s.inTransitNet).toBe(-4000);
    expect(s.settledCashBalance).toBe(0);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.settleDate).toBe('2026-05-14');
  });
});
