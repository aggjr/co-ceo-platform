/**
 * Tesouro Direto (LFT/NTN-B/LTN) no livro razão.
 *
 * Regra de domínio (co-CEO): cada papel é um ativo distinto. Não existe PU
 * "estimado" no código (hardcode de domínio proibido). PU vem do lançamento
 * que o usuário/translator importou — ou do extrato/nota da corretora.
 *
 * Esta camada hoje só fornece:
 *   - reconhecimento de família ("é Tesouro Direto?")
 *   - constante histórica do ticker consolidado "Tesouro Selic 2031" usada
 *     em views de portfólio (`portfolioMapper.consolidateTesouroPortfolioItems`).
 *
 * `canonicalTesouroTicker` e `normalizeLedgerLineQuantity` ficam como
 * identidade: o que entra no livro razão sai como veio.
 */

/** Ticker consolidado histórico — usado por views, não pela engine. */
export const TESOURO_SELIC_2031_TICKER = 'TESOURO-SELIC-2031';

export function isTesouroDiretoTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t.startsWith('LFT-') || t.startsWith('TESOURO-') || t.startsWith('TD-');
}

/** Identidade — não renomeia mais o ticker do Tesouro. Cada papel é único. */
export function canonicalTesouroTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

/**
 * Identidade — quantity e unit_price vêm do lançamento como foram registrados.
 * Translators (BTG, MyProfit) são responsáveis por entregar nº de títulos + PU
 * ANTES do livro razão. Sem PU "estimado".
 */
export function normalizeTesouroLedgerQuantity(line: {
  quantity: number;
  unit_price: number;
}): { quantity: number; unit_price: number } {
  return {
    quantity: Number(line.quantity),
    unit_price: Number(line.unit_price),
  };
}

/** Identidade — abrange Tesouro e demais ativos sem normalizações. */
export function normalizeLedgerLineQuantity(
  _ticker: string,
  line: {
    quantity: number;
    unit_price: number;
  }
): { quantity: number; unit_price: number } {
  return {
    quantity: Number(line.quantity),
    unit_price: Number(line.unit_price),
  };
}
