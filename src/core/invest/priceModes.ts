/**
 * Modos de preço médio por ativo (ação mãe).
 *
 * Lote: quando qty zera, os três preços resetam; nova entrada de ações abre lote
 * do zero. Opções/proventos só entram no Meu PM com ação em carteira no lote
 * atual (pré-lote → só pivot até exercício gerar ações ou compra abrir custódia).
 *
 * - STRICT (estrito): custo de aquisição (mercado ou strike no exercício) +
 *   prêmio pago se CALL comprada foi exercida. Só opções exercidas entram.
 * - B3: igual ao estrito, menos o prêmio de PUT vendida exercida.
 *   Lucro com trade = PM B3 na venda − PM B3 na compra.
 * - MANAGERIAL (Meu PM): estrito − entradas + custos enquanto o ativo estiver
 *   em carteira no lote atual — opções, dividendos, JCP, locação BTC, etc.
 */

export type PriceMode = 'strict' | 'b3' | 'managerial';

export const PRICE_MODE_LABELS: Record<PriceMode, string> = {
  strict: 'Preço estrito',
  b3: 'Preço B3 (myProfit)',
  managerial: 'Preço gerencial',
};
