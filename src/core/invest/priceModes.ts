/**
 * Modos de preço médio por ativo (ação mãe).
 *
 * - STRICT (estrito): só compras/vendas do papel; ignora efeito de PUT no exercício.
 * - B3: alinhado ao myProfit/B3 — PUT vendida exercida reduz o PM; CALL comprada
 *   exercida eleva o PM (strike + prêmio pago na call + custos da entrada).
 * - MANAGERIAL (gerencial): ajusta o PM da ação com ganhos/perdas de TODAS as opções
 *   daquele underlying (call/put, compra/venda). Prejuízo em opção ↑ PM; ganho ↓ PM.
 *   Fase atual: só opções entram no gerencial (sem dividendo, JCP, locação, etc.).
 */

export type PriceMode = 'strict' | 'b3' | 'managerial';

export const PRICE_MODE_LABELS: Record<PriceMode, string> = {
  strict: 'Preço estrito',
  b3: 'Preço B3 (myProfit)',
  managerial: 'Preço gerencial',
};
