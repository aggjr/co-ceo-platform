import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import {
  buildCashBalanceGapLine,
  buildCashBalanceGapLineFromDelta,
  CASH_BALANCE_GAP_TOLERANCE,
  ensureCashBalanceGapsFromSnapshot,
  ensureMonthImportCashBalanceGaps,
} from '../../../src/core/invest/CashBalanceGapService';
import type { BrokerCustodySnapshotRecord } from '../../../src/core/invest/brokerCustodySnapshotTypes';
import { inferBusinessEventKind } from '../../../src/core/invest/inferBusinessEventKind';
import { MONTH_IMPORT_CASH_TOLERANCE } from '../../../src/core/invest/btgExtractBatchReconcile';

function cashEvent(date: string, net: number, ref?: string): LedgerEvent {
  return {
    asset_ticker: 'CAIXA-BTG',
    asset_type: 'cash',
    transaction_date: date,
    transaction_type: 'cash_yield',
    total_net_value: net,
    broker_note_ref: ref ?? `REF-${date}`,
  } as LedgerEvent;
}

describe('CashBalanceGapService', () => {
  it('buildCashBalanceGapLine retorna null quando delta <= tolerancia', () => {
    expect(buildCashBalanceGapLine('2026-06-17', 1000, 999.96)).toBeNull();
    expect(buildCashBalanceGapLine('2026-06-17', 1000, 1000)).toBeNull();
  });

  it('buildCashBalanceGapLine usa brokerCash - systemSettled', () => {
    const line = buildCashBalanceGapLine('2026-06-17', 1003, 1000);
    expect(line).not.toBeNull();
    expect(line!.total_net_value).toBe(3);
    expect(line!.operation).toBe('cash_balance_gap');
    expect(line!.event_source_ref).toBe('BTG-GAP:2026-06-17:settled:300');
    expect(line!.broker_note_ref).toBe('BTG-GAP:2026-06-17:settled:300');
    expect(inferBusinessEventKind(line!, 'cash_movement')).toBe('unknown_invest_event');
  });

  it('buildCashBalanceGapLine aceita delta negativo', () => {
    const line = buildCashBalanceGapLine('2026-06-17', 997, 1000);
    expect(line!.total_net_value).toBe(-3);
    expect(line!.event_source_ref).toBe('BTG-GAP:2026-06-17:settled:-300');
  });

  it('ensureCashBalanceGapsFromSnapshot grava gap idempotente', async () => {
    const imported: unknown[] = [];
    const ledger = {
      importEntriesOnly: jest.fn(async (_ctx, entries) => {
        imported.push(...entries);
        return { batchId: 'b1', inserted: entries.length, skipped: 0, enriched: 0 };
      }),
    };
    const snapshot = {
      composition: { cash: 1003, inTransit: 0, fixedIncome: 0, variableIncome: 0, derivatives: 0, totalPatrimony: 0 },
    } as BrokerCustodySnapshotRecord;
    const events = [cashEvent('2026-06-01', 1000)];

    const first = await ensureCashBalanceGapsFromSnapshot(
      { organizationId: 'org1' } as never,
      ledger as never,
      events,
      snapshot,
      '2026-06-17'
    );
    expect(first.created).toBe(1);
    expect(first.gapAmount).toBe(3);
    expect(imported).toHaveLength(1);

    const withGap = [
      ...events,
      {
        ...cashEvent('2026-06-17', 3, 'BTG-GAP:2026-06-17:settled:300'),
        transaction_type: 'cash_balance_gap',
      } as LedgerEvent,
    ];
    const second = await ensureCashBalanceGapsFromSnapshot(
      { organizationId: 'org1' } as never,
      ledger as never,
      withGap,
      snapshot,
      '2026-06-17'
    );
    expect(second.created).toBe(0);
    expect(ledger.importEntriesOnly).toHaveBeenCalledTimes(1);
  });

  it('ensureCashBalanceGapsFromSnapshot sem snapshot nao grava', async () => {
    const ledger = {
      importEntriesOnly: jest.fn(),
    };
    const result = await ensureCashBalanceGapsFromSnapshot(
      { organizationId: 'org1' } as never,
      ledger as never,
      [],
      null,
      '2026-06-17'
    );
    expect(result.created).toBe(0);
    expect(ledger.importEntriesOnly).not.toHaveBeenCalled();
  });

  it('ensureMonthImportCashBalanceGaps grava residuo dentro da tolerancia mensal', async () => {
    const imported: unknown[] = [];
    const ledger = {
      listLedgerEvents: jest.fn(async () => []),
      importEntriesOnly: jest.fn(async (_ctx, entries) => {
        imported.push(...entries);
        return { batchId: 'b1', inserted: entries.length, skipped: 0, enriched: 0 };
      }),
    };

    const delta = 10;
    expect(delta).toBeLessThanOrEqual(MONTH_IMPORT_CASH_TOLERANCE);
    expect(Math.abs(delta)).toBeGreaterThan(CASH_BALANCE_GAP_TOLERANCE);

    await ensureMonthImportCashBalanceGaps(
      { organizationId: 'org1' } as never,
      ledger as never,
      {
        month: '2026-04',
        openingExtract: 1000,
        closingExtract: 1010,
        closingDate: '2026-04-30',
        openingChainOk: true,
        openingChainDelta: 0,
        openingLedgerOk: true,
        openingLedgerBalance: 990,
        openingLedgerDelta: delta,
        closingLedgerOk: true,
        closingLedgerBalance: 1000,
        closingLedgerDelta: delta,
        monthAlreadyImported: false,
      },
      '2026-04',
      '2026-04-02'
    );

    expect(imported).toHaveLength(2);
    expect((imported[0] as { total_net_value?: number }).total_net_value).toBe(delta);
    expect((imported[1] as { total_net_value?: number }).total_net_value).toBe(delta);
  });

  it('buildCashBalanceGapLineFromDelta respeita tolerancia minima', () => {
    expect(buildCashBalanceGapLineFromDelta('2026-04-30', 0.03)).toBeNull();
    expect(buildCashBalanceGapLineFromDelta('2026-04-30', 3)?.total_net_value).toBe(3);
  });
});
