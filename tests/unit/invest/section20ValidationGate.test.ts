/**
 * Gate de validacao independente (secao 20.1) — checagens adversariais
 * separadas dos testes do executor. Falha se invariante nao fechar.
 */
import {
  buildCashBalanceGapLine,
  CASH_BALANCE_GAP_TOLERANCE,
} from '../../../src/core/invest/CashBalanceGapService';
import {
  isEconomicConservationExempt,
  BusinessEventReconciler,
} from '../../../src/core/business-events/BusinessEventReconciler';
import { inferUnderlyingTicker } from '../../../src/core/invest/assetClassifier';
import { inferBusinessEventKind } from '../../../src/core/invest/inferBusinessEventKind';
import { buildStockUnderlyingPivot } from '../../../src/core/invest/StockUnderlyingPivotEngine';
import { MarketCalendarService, DEFAULT_B3_EXCHANGE_CODE } from '../../../src/core/invest/MarketCalendarService';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import { settledCashBalanceFromLedger } from '../../../src/core/invest/cashInvestLedger';
import {
  buildPatrimonyAnchorDivergenceLine,
  ensurePatrimonyAnchorDivergence,
  PATRIMONY_ANCHOR_DIVERGENCE_TOLERANCE,
} from '../../../src/core/invest/PatrimonyAnchorDivergenceService';
import {
  PATRIMONY_META_BTG_INTERPOLATED,
  resolvePatrimonyChartQuery,
} from '../../../src/core/invest/patrimonyChartMethods';
import fs from 'fs';
import path from 'path';

describe('section20 validation gate (independente)', () => {
  describe('GAP-M01 — gap explicito fecha saldo com corretora', () => {
    it('apos gap, settled + gap == broker (nao plug silencioso sem rastro)', () => {
      const asOf = '2026-06-17';
      const broker = 1003;
      const events = [
        {
          asset_ticker: 'CAIXA-BTG',
          asset_type: 'cash',
          transaction_date: asOf,
          transaction_type: 'cash_yield',
          total_net_value: 1000,
        } as LedgerEvent,
      ];
      const settledBefore = settledCashBalanceFromLedger(events, asOf);
      expect(settledBefore).toBe(1000);

      const line = buildCashBalanceGapLine(asOf, broker, settledBefore);
      expect(line).not.toBeNull();
      expect(line!.operation).toBe('cash_balance_gap');
      expect(inferBusinessEventKind(line!, 'cash_movement')).toBe('unknown_invest_event');

      const gap = Number(line!.total_net_value);
      const settledAfter = settledBefore + gap;
      expect(settledAfter).toBeCloseTo(broker, 2);
      expect(Math.abs(gap)).toBeGreaterThan(CASH_BALANCE_GAP_TOLERANCE);
    });
  });

  describe('EV-M01 — conservacao economica formula', () => {
    it('evento misto balanceado conserva; desbalanceado nao', () => {
      expect(isEconomicConservationExempt('cash_movement', 0, 1)).toBe(true);
      expect(isEconomicConservationExempt('brokerage_note_buy', 1, 1)).toBe(false);
    });

    it('reconciler manual: acquisition + out fecham zero', async () => {
      const gateway = {
        readQuery: jest.fn(),
        findWhere: jest.fn(),
        insert: jest.fn(),
        update: jest.fn(),
      };
      const registry = {
        findById: jest.fn(async () => ({
          id: 'ev1',
          event_kind: 'brokerage_note_buy',
          total_net: -1000,
          voided_at: null,
        })),
        listLegs: jest.fn(async () => ({
          patrimonyLegs: [
            { movement_type: 'acquisition', total_value: 1000, quantity_delta: 10 },
          ],
          financialLegs: [{ direction: 'out', amount: 1000, status: 'cleared' }],
        })),
      };
      const reconciler = new BusinessEventReconciler(gateway as never, registry as never);
      const report = await reconciler.reconcileEconomicConservation(
        { organizationId: 'org1' } as never,
        'ev1'
      );
      expect(report.skipped).toBe(false);
      expect(report.conserved).toBe(true);
      expect(Math.abs(report.conservationDelta)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('PIV-M02 — split nao distorce P&L pos-split', () => {
    it('venda pos-split reflete custo medio correto (100@40 -> split 200 -> sell 200@21)', () => {
      const entries: LedgerEvent[] = [
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'buy',
          transaction_date: '2026-03-01',
          quantity: 100,
          unit_price: 40,
          total_net_value: -4000,
          impacts_managerial_price: true,
        } as LedgerEvent,
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'split',
          transaction_date: '2026-03-05',
          quantity: 200,
          unit_price: 20,
          total_net_value: 0,
          impacts_managerial_price: true,
        } as LedgerEvent,
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'sell',
          transaction_date: '2026-03-10',
          quantity: 200,
          unit_price: 21,
          total_net_value: 4200,
          impacts_managerial_price: true,
        } as LedgerEvent,
      ];
      const r = buildStockUnderlyingPivot(entries, '2026-03-01', '2026-03-31');
      const row = r.rows.find((x) => x.underlying === 'PRIO3');
      expect(row).toBeDefined();
      expect(row!.trade).toBeCloseTo(200, 0);
    });
  });

  describe('PIV-A01 — underlying via catalogo', () => {
    it('explicit vence catalogo e heuristica', () => {
      const catalog = new Map([['PRION410', 'PRIO3']]);
      expect(inferUnderlyingTicker('PRION410', 'PETR4', catalog)).toBe('PETR4');
    });

    it('catalogo resolve underlying fora do mapa hardcoded', () => {
      const catalog = new Map([['PRIOA100', 'PRIO3']]);
      expect(inferUnderlyingTicker('PRIOA100', undefined, catalog)).toBe('PRIO3');
      const entries: LedgerEvent[] = [
        {
          asset_id: 'o1',
          asset_ticker: 'PRIOA100',
          asset_type: 'option_call',
          transaction_type: 'call_sell',
          transaction_date: '2026-03-05',
          quantity: -10,
          unit_price: 0.5,
          total_net_value: 500,
          impacts_managerial_price: true,
        } as LedgerEvent,
      ];
      const r = buildStockUnderlyingPivot(entries, '2026-03-01', '2026-03-31', {
        underlyingCatalog: catalog,
      });
      expect(r.rows.find((x) => x.underlying === 'PRIO3')).toBeDefined();
    });
  });

  describe('CLD-M01 — feriado B3 conhecido', () => {
    const ctx = { organizationId: 'org1', userId: 'u1' } as never;
    const holidays = [
      '2026-01-01',
      '2026-02-16',
      '2026-02-17',
      '2026-04-03',
      '2026-04-21',
      '2026-05-01',
      '2026-06-04',
      '2026-09-07',
      '2026-10-12',
      '2026-11-02',
      '2026-11-15',
      '2026-12-25',
    ].map((holiday_date) => ({ holiday_date, exchange_code: DEFAULT_B3_EXCHANGE_CODE }));

    it('2026-01-01 e feriado via catalogo (nao dia util)', async () => {
      const svc = new MarketCalendarService({
        findWhere: jest.fn(async () => holidays),
      } as never);
      expect(await svc.isWeekendOrHoliday(ctx, '2026-01-01')).toBe(true);
    });
    it('2026-06-17 e dia util', async () => {
      const svc = new MarketCalendarService({
        findWhere: jest.fn(async () => holidays),
      } as never);
      expect(await svc.isWeekendOrHoliday(ctx, '2026-06-17')).toBe(false);
    });
  });

  describe('PIV-S02 — batimento parcial com fluxo de caixa do ledger', () => {
    it('soma total_net_value periodo == ganho_aproximado para fixture fechado', () => {
      const entries: LedgerEvent[] = [
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'buy',
          transaction_date: '2026-03-01',
          quantity: 100,
          unit_price: 40,
          total_net_value: -4000,
          impacts_managerial_price: true,
        } as LedgerEvent,
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'sell',
          transaction_date: '2026-03-10',
          quantity: 100,
          unit_price: 42,
          total_net_value: 4200,
          brokerage_fee: 10,
          impacts_managerial_price: true,
        } as LedgerEvent,
      ];
      const r = buildStockUnderlyingPivot(entries, '2026-03-01', '2026-03-31');
      const row = r.rows.find((x) => x.underlying === 'PRIO3')!;
      const ledgerCashNet = entries
        .filter((e) => {
          const d = String(e.transaction_date ?? '');
          return d >= '2026-03-01' && d <= '2026-03-31';
        })
        .reduce((s, e) => s + Number(e.total_net_value ?? 0), 0);
      const feesOnTrades = entries.reduce(
        (s, e) => s + Number((e as LedgerEvent & { brokerage_fee?: number }).brokerage_fee ?? 0),
        0
      );
      const economicFromLedger = ledgerCashNet - feesOnTrades;
      expect(row.trade + row.taxas).toBeCloseTo(economicFromLedger, 0);
      expect(row.ganho_aproximado).toBeCloseTo(economicFromLedger, 0);
    });

    it('fixture com opcao, dividendo e trade fecha ganho_aproximado vs ledger', () => {
      const catalog = new Map([['PRIOA100', 'PRIO3']]);
      const entries: LedgerEvent[] = [
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'buy',
          transaction_date: '2026-03-01',
          quantity: 100,
          unit_price: 40,
          total_net_value: -4010,
          brokerage_fee: 10,
          impacts_managerial_price: true,
        } as LedgerEvent,
        {
          asset_id: 'o1',
          asset_ticker: 'PRIOA100',
          asset_type: 'option_call',
          transaction_type: 'call_sell',
          transaction_date: '2026-03-05',
          quantity: -1000,
          unit_price: 0.5,
          total_net_value: 500,
          impacts_managerial_price: true,
        } as LedgerEvent,
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'dividend',
          transaction_date: '2026-03-08',
          quantity: 0,
          unit_price: 0,
          total_net_value: 300,
          impacts_managerial_price: false,
        } as LedgerEvent,
        {
          asset_id: 's1',
          asset_ticker: 'PRIO3',
          asset_type: 'stock',
          transaction_type: 'sell',
          transaction_date: '2026-03-10',
          quantity: 100,
          unit_price: 42,
          total_net_value: 4190,
          brokerage_fee: 10,
          impacts_managerial_price: true,
        } as LedgerEvent,
      ];
      const r = buildStockUnderlyingPivot(entries, '2026-03-01', '2026-03-31', {
        underlyingCatalog: catalog,
      });
      const row = r.rows.find((x) => x.underlying === 'PRIO3')!;
      const ledgerCashNet = entries
        .filter((e) => {
          const d = String(e.transaction_date ?? '').slice(0, 10);
          return d >= '2026-03-01' && d <= '2026-03-31';
        })
        .reduce((s, e) => s + Number(e.total_net_value ?? 0), 0);
      expect(row.venda_call).toBeCloseTo(500, 0);
      expect(row.dividendos).toBeCloseTo(300, 0);
      expect(row.trade).toBeCloseTo(200, 0);
      expect(row.ganho_aproximado).toBeCloseTo(ledgerCashNet, 0);
    });
  });

  describe('PAT-M01 — divergencia patrimonial vs ancora vira evento auditavel', () => {
    it('nao ajusta patrimonio: linha explicita com kind unknown_invest_event', () => {
      const line = buildPatrimonyAnchorDivergenceLine('2026-01-31', 1_000_000, 1_100_000);
      expect(line).not.toBeNull();
      expect(line!.operation).toBe('patrimony_anchor_divergence');
      expect(line!.impacts_managerial_price).toBe(false);
      expect(inferBusinessEventKind(line!, 'cash_movement')).toBe('unknown_invest_event');
      expect(Math.abs(line!.total_net_value!)).toBeGreaterThan(PATRIMONY_ANCHOR_DIVERGENCE_TOLERANCE);
    });

    it('ensurePatrimonyAnchorDivergence e idempotente por event_source_ref', async () => {
      const asOf = '2026-01-31';
      const line = buildPatrimonyAnchorDivergenceLine(asOf, 1_000_000, 1_100_000)!;
      const events = [
        {
          asset_ticker: line.ticker,
          broker_note_ref: line.event_source_ref,
          transaction_date: asOf,
        },
      ] as never[];
      const ledger = { importEntriesOnly: jest.fn() };
      const ctx = { organizationId: 'org1' } as never;

      const first = await ensurePatrimonyAnchorDivergence(
        ctx,
        ledger as never,
        events,
        asOf,
        1_000_000,
        1_100_000
      );
      expect(first.created).toBe(0);
      expect(first.skipped).toBe(1);
      expect(ledger.importEntriesOnly).not.toHaveBeenCalled();
    });
  });

  describe('CAL-A01 — nomenclatura canonica (sem calibrateToAnchors)', () => {
    it('alias legado mtm_btg_calibrated vira mtm_economic + compareAnchor', () => {
      const legacy = resolvePatrimonyChartQuery('mtm_btg_calibrated');
      expect(legacy.method).toBe('mtm_economic');
      expect(legacy.compareAnchor).toBe(true);
      const canonical = resolvePatrimonyChartQuery('mtm_economic', 'true');
      expect(canonical.compareAnchor).toBe(true);
    });

    it('engine e controller nao expoem calibrateToAnchors', () => {
      const engineSrc = fs.readFileSync(
        path.join(__dirname, '../../../src/core/invest/PatrimonyMtmDailyEngine.ts'),
        'utf8'
      );
      const controllerSrc = fs.readFileSync(
        path.join(__dirname, '../../../src/controllers/InvestController.ts'),
        'utf8'
      );
      expect(engineSrc).not.toMatch(/calibrateToAnchors/);
      expect(controllerSrc).not.toMatch(/calibrateToAnchors/);
      expect(PATRIMONY_META_BTG_INTERPOLATED).toBe('mtm_btg_interpolated');
    });
  });
});
