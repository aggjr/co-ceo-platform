import { ReconciliationDiagnosticsService } from '../../../../src/core/invest/reconcile/ReconciliationDiagnosticsService';
import { AUTO_D2_REF_PREFIX } from '../../../../src/core/invest/AutoPendingSettlementSync';
import type { LedgerEvent } from '../../../../src/core/invest/CustodyEngine';

describe('ReconciliationDiagnosticsService daily audit', () => {
  it('trata abertura como estado inicial e liquida transito vencido sem anular caixa', () => {
    const service = new ReconciliationDiagnosticsService({} as any);
    const tradeId = 'trade-prio-1';
    const events: LedgerEvent[] = [
      {
        id: 'cash-opening',
        asset_id: 'cash',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 0,
        unit_price: 0,
        total_net_value: 58_758.79,
        business_event_id: 'opening-event',
      },
      {
        id: 'asset-opening',
        asset_id: 'prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 10,
        unit_price: 100,
        total_net_value: 1000,
        business_event_id: 'opening-event',
      },
      {
        id: tradeId,
        asset_id: 'prio',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-05',
        quantity: 1,
        unit_price: 400,
        total_net_value: -400,
        business_event_id: 'trade-event',
      },
      {
        id: 'pending-open',
        asset_id: 'cash',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: '2026-01-05',
        settlement_date: '2026-01-07',
        quantity: 0,
        unit_price: 0,
        total_net_value: -400,
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}`,
        business_event_id: 'trade-event',
      },
      {
        id: 'pending-clear',
        asset_id: 'cash',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: '2026-01-07',
        settlement_date: '2026-01-07',
        quantity: 0,
        unit_price: 0,
        total_net_value: 400,
        broker_note_ref: `${AUTO_D2_REF_PREFIX}${tradeId}:CLEAR`,
        business_event_id: 'trade-event',
      },
    ];

    const report = (service as any).buildDailyAuditRows(events, '2026-01-08');
    const jan1Financial = report.financial.find((row: any) => row.date === '2026-01-01');
    const jan1Business = report.business.find((row: any) => row.date === '2026-01-01');
    const jan1Portfolio = report.portfolio.find((row: any) => row.date === '2026-01-01');
    const jan6Financial = report.financial.find((row: any) => row.date === '2026-01-06');
    const jan7Financial = report.financial.find((row: any) => row.date === '2026-01-07');

    expect(jan1Financial.openingCash).toBeCloseTo(58_758.79, 2);
    expect(jan1Business.status).toBe('ok');
    expect(jan1Business.businessEvents).toBe(0);
    expect(jan1Portfolio.openingPortfolioValue).toBeCloseTo(1000, 2);
    expect(jan1Portfolio.assetMovementDelta).toBeCloseTo(0, 2);
    expect(jan6Financial.openingTransit).toBeCloseTo(-400, 2);
    expect(jan7Financial.openingTransit).toBeCloseTo(0, 2);
    expect(jan7Financial.openingCash).toBeCloseTo(58_358.79, 2);
  });
});
