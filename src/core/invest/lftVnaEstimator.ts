/**
 * Estimador de VNA (Valor Nominal Atualizado) do LFT / Tesouro Selic.
 *
 * O VNA do LFT cresce diariamente pela taxa Selic over (acumulado diário).
 * Como não temos a série histórica exata do BACEN aqui, usamos a fórmula
 * de capitalização composta a partir de um ponto de referência conhecido
 * (tipicamente o opening balance do portfólio).
 *
 * Precisão: erro < 0,3% para períodos de até 6 meses com Selic constante.
 * Quando disponível, substituir por série histórica via API BACEN/SGS 432.
 *
 * Referência: https://www.tesouro.fazenda.gov.br/tesouro-direto-lft
 */

const DIAS_UTEIS_POR_ANO = 252;

/**
 * Calcula o número aproximado de dias úteis entre duas datas ISO (YYYY-MM-DD).
 * Aproximação: dias corridos × (252/365). Suficiente para a precisão necessária.
 */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T12:00:00Z');
  const to = new Date(toIso + 'T12:00:00Z');
  const calendarDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  return Math.round(calendarDays * (DIAS_UTEIS_POR_ANO / 365));
}

/**
 * Estima o VNA do LFT em `targetDate` a partir de um ponto de referência.
 *
 * @param refDate   Data ISO do ponto de referência (ex: data de abertura)
 * @param refVna    VNA conhecido nessa data (ex: 1000341.65)
 * @param targetDate Data ISO para a qual queremos estimar o VNA
 * @param selicAnual Taxa Selic anual como decimal (ex: 0.1375 para 13,75% a.a.)
 */
export function estimateLftVna(
  refDate: string,
  refVna: number,
  targetDate: string,
  selicAnual: number
): number {
  const n = businessDaysBetween(refDate, targetDate);
  if (n === 0) return refVna;
  const dailyFactor = Math.pow(1 + selicAnual, 1 / DIAS_UTEIS_POR_ANO);
  return refVna * Math.pow(dailyFactor, n);
}

/**
 * Normaliza um lançamento LFT do extrato BTG (que chega como valor financeiro
 * com unit_price=1) para a representação correta: número de cotas × VNA.
 *
 * Entrada:  { quantity: 54160.08, unit_price: 1 }   (valor financeiro bruto)
 * Saída:    { quantity: 0.054143, unit_price: 1000701.23 }  (cotas × VNA estimado)
 *
 * O arredondamento de quantity para 6 casas decimais é consistente com a
 * precisão do Tesouro Direto (mínimo de 0,01 título = 0,01 cota).
 */
export function normalizeLftExtractEntry(
  financialAmount: number,
  transactionDate: string,
  refDate: string,
  refVna: number,
  selicAnual: number
): { quantity: number; unit_price: number } {
  const vna = estimateLftVna(refDate, refVna, transactionDate, selicAnual);
  const quantity = Math.round((financialAmount / vna) * 1e6) / 1e6;
  return { quantity, unit_price: Math.round(vna * 100) / 100 };
}
