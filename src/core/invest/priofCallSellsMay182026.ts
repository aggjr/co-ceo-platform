import type { LedgerImportLine } from './ledgerTypes';

/** Vendas CALL PRIOF 18/05/2026 — prêmio líquido total R$ 3.094,00 (D+1 na conta). */
export const PRIOF_CALL_SELLS_2026_05_18: LedgerImportLine[] = [
  {
    date: '2026-05-18',
    ticker: 'PRIOF780',
    operation: 'call_sell',
    quantity: 500,
    unit_price: 0.88,
    total_net_value: 440,
    asset_type: 'option_call',
    underlying_ticker: 'PRIO3',
    option_strike: 78,
    broker_note_ref: 'BTG-EXT-20260518-PRIOF780',
    notes: 'Venda CALL PRIOF780 (executada limitada)',
  },
  {
    date: '2026-05-18',
    ticker: 'PRIOF760',
    operation: 'call_sell',
    quantity: 900,
    unit_price: 1.24,
    total_net_value: 1116,
    asset_type: 'option_call',
    underlying_ticker: 'PRIO3',
    option_strike: 76,
    broker_note_ref: 'BTG-EXT-20260518-PRIOF760',
    notes: 'Venda CALL PRIOF760 (executada limitada)',
  },
  {
    date: '2026-05-18',
    ticker: 'PRIOF750',
    operation: 'call_sell',
    quantity: 700,
    unit_price: 1.46,
    total_net_value: 1022,
    asset_type: 'option_call',
    underlying_ticker: 'PRIO3',
    option_strike: 75,
    broker_note_ref: 'BTG-EXT-20260518-PRIOF750',
    notes: 'Venda CALL PRIOF750 (executada limitada)',
  },
  {
    date: '2026-05-18',
    ticker: 'PRIOF740',
    operation: 'call_sell',
    quantity: 300,
    unit_price: 1.72,
    total_net_value: 516,
    asset_type: 'option_call',
    underlying_ticker: 'PRIO3',
    option_strike: 74,
    broker_note_ref: 'BTG-EXT-20260518-PRIOF740',
    notes: 'Venda CALL PRIOF740 (executada limitada)',
  },
];

export const PRIOF_CALL_PREMIUM_TOTAL_2026_05_18 = PRIOF_CALL_SELLS_2026_05_18.reduce(
  (s, l) => s + Number(l.total_net_value ?? 0),
  0
);
