import {
  isBtgHomeBrokerRef,
  normalizeBtgHomeBrokerLine,
} from '../../../src/core/invest/btgHomeBrokerImport';
import type { LedgerImportLine } from '../../../src/core/invest/ledgerTypes';

describe('btgHomeBrokerImport', () => {
  it('aceita somente ref B3_BTG Pactual', () => {
    expect(isBtgHomeBrokerRef('B3_BTG Pactual_17032026#ITUBQ429#2026-03-17#-1000#Venda')).toBe(
      true
    );
    expect(isBtgHomeBrokerRef('B3_ALUGUEL_BTG Pactual_17012026#PRIO3')).toBe(false);
  });

  it('corrige underlying ITUB3 → ITUB4 em opção ITUB', () => {
    const line: LedgerImportLine = {
      date: '2026-03-17',
      ticker: 'ITUBQ429',
      asset_type: 'option_put',
      underlying_ticker: 'ITUB3',
      operation: 'put_sell',
      quantity: 1000,
      unit_price: 0.66,
      total_net_value: 660,
      broker_note_ref: 'B3_BTG Pactual_17032026#ITUBQ429#2026-03-17#-1000#Venda',
      notes: 'Ordem V — ITUBQ429',
    };
    const out = normalizeBtgHomeBrokerLine(line);
    expect(out.underlying_ticker).toBe('ITUB4');
    expect(out.notes).toMatch(/BTG home broker/i);
  });
});
