import type { LedgerImportLine } from './ledgerTypes';
import { TESOURO_SELIC_2031_TICKER } from './tesouroDirectLedger';

/**
 * Extrato BTG conta investimento — conferido com o titular em 19/05/2026.
 * Valores em R$ exatamente como no extrato (movimentação).
 */
export const BTG_EXTRACT_2026_05_18_19: LedgerImportLine[] = [
  {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -711.34,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260518-IRRF-LFT-71134',
    notes: 'IRRF cobrado sobre operacao de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -46.93,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260518-CUST-LFT-4693',
    notes: 'Taxa de custodia sobre operacao de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -38.44,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260518-CUST-LFT-3844',
    notes: 'Taxa de custodia sobre operacao de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: TESOURO_SELIC_2031_TICKER,
    operation: 'sell',
    quantity: 56807.16,
    unit_price: 1,
    total_net_value: 56807.16,
    asset_type: 'fixed_income',
    broker_note_ref: 'BTG-EXT-20260518-LFT-SELL-5680716',
    notes: 'Venda de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -595.59,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260518-IRRF-LFT-59559',
    notes: 'IRRF cobrado sobre operacao de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: TESOURO_SELIC_2031_TICKER,
    operation: 'sell',
    quantity: 284035.8,
    unit_price: 1,
    total_net_value: 284035.8,
    asset_type: 'fixed_income',
    broker_note_ref: 'BTG-EXT-20260518-LFT-SELL-2840358',
    notes: 'Venda de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -4982.73,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260518-IRRF-LFT-498273',
    notes: 'IRRF cobrado sobre operacao de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-18',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -358.11,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260518-CUST-LFT-35811',
    notes: 'Taxa de custodia sobre operacao de Tesouro Direto: LFT 01/03/2031',
  },
  {
    date: '2026-05-19',
    ticker: 'CAIXA-BTG',
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: -453223.65,
    asset_type: 'cash',
    broker_note_ref: 'BTG-EXT-20260519-LIQ-BOLSA-1505',
    impacts_managerial_price: false,
    notes: 'LIQ BOLSA (Operacoes)- Pregão:15/05/2026',
  },
];

/** Soma das movimentações do extrato (conferência). */
export function btgExtractMay182026NetCash(): number {
  return BTG_EXTRACT_2026_05_18_19.reduce(
    (s, line) => s + Number(line.total_net_value ?? 0),
    0
  );
}
