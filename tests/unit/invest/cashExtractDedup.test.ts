import {
  cashNetKey,
  findBtgExtractCashDuplicates,
  importLineExpectedCashNet,
} from '../../../src/core/invest/cashExtractDedup';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import { LEDGER_TRANSACTION_TYPES, type LedgerImportLine } from '../../../src/core/invest/ledgerTypes';
import {
  buildLedgerDedupIndex,
  lookupDuplicate,
} from '../../../src/core/invest/ledgerOperationDedup';

describe('cashExtractDedup', () => {
  it('importLineExpectedCashNet para venda', () => {
    const line: LedgerImportLine = {
      date: '2026-05-18',
      ticker: 'LFTS11',
      operation: 'sell',
      quantity: 1,
      unit_price: 284035.8,
      total_net_value: 284035.8,
    };
    expect(importLineExpectedCashNet(line)).toBe(284035.8);
  });

  it('importLineExpectedCashNet preserva sinal de pending_settlement', () => {
    const line: LedgerImportLine = {
      date: '2026-04-22',
      ticker: 'CAIXA-BTG',
      operation: 'pending_settlement',
      quantity: 0,
      unit_price: 0,
      total_net_value: -821929.04,
    };
    expect(importLineExpectedCashNet(line)).toBe(-821929.04);
  });

  it('findBtgExtractCashDuplicates encontra par EXTRACT/EXT', () => {
    const events = [
      {
        id: 'ext1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_date: '2026-05-18',
        total_net_value: 284035.8,
        broker_note_ref: 'BTG-EXT-2026-05-18#3',
      },
      {
        id: 'dup1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_date: '2026-05-18',
        total_net_value: 284035.8,
        broker_note_ref: 'BTG-EXTRACT:2026-05-18:284035.80',
      },
    ] as LedgerEvent[];

    const dups = findBtgExtractCashDuplicates(events);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.extractEventId).toBe('dup1');
    expect(dups[0]!.twinRef).toBe('BTG-EXT-2026-05-18#3');
  });

  it('reconhece os dois tipos de diferença desconhecida no catálogo', () => {
    expect(LEDGER_TRANSACTION_TYPES).toContain('extract_divergence');
    expect(LEDGER_TRANSACTION_TYPES).toContain('cash_balance_gap');
  });

  it('cash_balance_gap não é tratado como renda/despesa/trade na dedup de caixa', () => {
    // Sem mapeamento em importLineExpectedCashNet => não casa por valor com
    // outros lançamentos; o resíduo explícito não some na deduplicação.
    const line: LedgerImportLine = {
      date: '2026-05-31',
      ticker: 'CAIXA-BTG',
      operation: 'cash_balance_gap',
      quantity: 0,
      unit_price: 0,
      total_net_value: -123.45,
    };
    expect(importLineExpectedCashNet(line)).toBeNull();
  });

  it('lookupDuplicate por cash_net evita reimportar extrato', () => {
    const events = [
      {
        id: 'c1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_date: '2026-05-18',
        total_net_value: 284035.8,
        broker_note_ref: 'BTG-EXT-2026-05-18#3',
      },
    ] as LedgerEvent[];
    const index = buildLedgerDedupIndex(events);
    const line: LedgerImportLine = {
      date: '2026-05-18',
      ticker: 'LFTS11',
      operation: 'sell',
      quantity: 1,
      unit_price: 284035.8,
      total_net_value: 284035.8,
      broker_note_ref: 'BTG-EXTRACT:2026-05-18:284035.80',
    };
    const dup = lookupDuplicate(index, line);
    expect(dup?.match).toBe('cash_net');
    expect(cashNetKey(line.date, importLineExpectedCashNet(line)!)).toBe(
      cashNetKey('2026-05-18', 284035.8)
    );
  });
});
