import { describe, expect, it } from 'vitest';
import {
  filterFilesForMonth,
  isMonthBtgImportCashEvent,
  stripBtgImportCashFromMonthForward,
  stripMonthImportCashFromLedger,
} from '../../../src/core/invest/btgMonthImportService';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('btgMonthImportService', () => {
  it('filterFilesForMonth por pasta 2026-01', () => {
    const files = [
      { name: 'Notas/2026-01/nota1.pdf', contentBase64: 'x' },
      { name: 'Notas/2026-02/nota2.pdf', contentBase64: 'x' },
      { name: 'jan_2026/all.pdf', contentBase64: 'x' },
    ];
    const jan = filterFilesForMonth(files, '2026-01');
    expect(jan.map((f) => f.name)).toContain('Notas/2026-01/nota1.pdf');
    expect(jan.map((f) => f.name)).toContain('jan_2026/all.pdf');
    expect(jan.map((f) => f.name)).not.toContain('Notas/2026-02/nota2.pdf');
  });

  it('stripMonthImportCashFromLedger remove caixa do mês mas preserva abertura', () => {
    const events: LedgerEvent[] = [
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-01-01',
        total_net_value: 58_758.79,
        broker_note_ref: 'OPENING:2026-01-01:CAIXA-BTG',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-01-16',
        total_net_value: 219_989.71,
        broker_note_ref: 'BTG-NOTA-27994603#2026-01-16#1:CASH',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-01-09',
        total_net_value: -54_160.08,
        broker_note_ref: 'BTG-EXT-2026-01-09#01',
      } as LedgerEvent,
    ];
    const stripped = stripMonthImportCashFromLedger(events, '2026-01');
    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.broker_note_ref).toContain('OPENING:');
    expect(isMonthBtgImportCashEvent(events[1]!, '2026-01')).toBe(true);
    expect(isMonthBtgImportCashEvent(events[0]!, '2026-01')).toBe(false);
  });

  it('stripBtgImportCashFromMonthForward remove caixa do mês alvo e posteriores', () => {
    const events: LedgerEvent[] = [
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-02-28',
        broker_note_ref: 'BTG-EXT-2026-02-28#01',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-03-05',
        broker_note_ref: 'BTG-EXT-2026-03-05#01',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-04-01',
        broker_note_ref: 'BTG-EXT-2026-04-01#01',
      } as LedgerEvent,
    ];
    const stripped = stripBtgImportCashFromMonthForward(events, '2026-03');
    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.transaction_date).toBe('2026-02-28');
  });
});
