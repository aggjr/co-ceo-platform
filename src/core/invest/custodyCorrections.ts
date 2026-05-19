import { BTG_EXTRACT_2026_05_18_19 } from './btgExtractMay182026';
import { PRIOF_CALL_SELLS_2026_05_18 } from './priofCallSellsMay182026';

/** Ativos fantasma — autorizado pelo titular para exclusão da custódia aberta. */
export const AUTHORIZED_GHOST_ASSET_TICKERS = ['CDB-BTG-20240802'] as const;

/** Lançamentos do extrato BTG 18–19/05 + vendas CALL PRIOF do dia. */
export const BTG_STATEMENT_IMPORT_LINES = [
  ...BTG_EXTRACT_2026_05_18_19,
  ...PRIOF_CALL_SELLS_2026_05_18,
];

/** Refs de correções antigas (venda “47 títulos” / prêmio estimado) — remover antes de reimportar extrato. */
export const OBSOLETE_CORRECTION_REFS = [
  'CORR-LFT-SELL-47-2026-05-18',
  'CORR-PRIOF-PREMIUM-2026-05-19',
  'BTG-LFT-SELL-47-2026-05-18',
] as const;

export function isGhostAssetTicker(ticker: string): boolean {
  return AUTHORIZED_GHOST_ASSET_TICKERS.includes(
    ticker.trim().toUpperCase() as (typeof AUTHORIZED_GHOST_ASSET_TICKERS)[number]
  );
}

export function isObsoleteCorrectionRef(ref: string | null | undefined): boolean {
  const r = String(ref || '').trim();
  if (!r) return false;
  if (OBSOLETE_CORRECTION_REFS.includes(r as (typeof OBSOLETE_CORRECTION_REFS)[number])) {
    return true;
  }
  return r.startsWith('CORR-');
}
