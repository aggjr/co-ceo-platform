/**
 * Rentabilidade mensal publicada pelo BTG (carteira vs CDI) — referência para conferência.
 * Fonte: capturas do app Necton/BTG (histórico rentabilidade + gráfico ano atual).
 */
export type BtgMonthlyReturn = {
  /** Primeiro dia do mês (YYYY-MM-01). */
  month: string;
  /** Retorno da carteira no mês (decimal, ex. 0.085 = 8,5%). */
  carteira: number;
  cdi: number;
};

export const BTG_CARTEIRA_MONTHLY_2026: BtgMonthlyReturn[] = [
  { month: '2026-01', carteira: 0.085, cdi: 0.0116 },
  { month: '2026-02', carteira: 0.0176, cdi: 0.01 },
  { month: '2026-03', carteira: 0.0479, cdi: 0.0121 },
  { month: '2026-04', carteira: 0.0729, cdi: 0.0109 },
  { month: '2026-05', carteira: 0.03, cdi: 0.0059 },
];

export function compoundMonthlyReturns(returns: number[]): number {
  return returns.reduce((f, r) => f * (1 + r), 1) - 1;
}

/** Retorno composto BTG (tabela mensal) entre meses inclusive. */
export function btgPublishedTwr(fromMonth: string, toMonth: string): number | null {
  const rows = BTG_CARTEIRA_MONTHLY_2026.filter((r) => r.month >= fromMonth && r.month <= toMonth);
  if (!rows.length) return null;
  return compoundMonthlyReturns(rows.map((r) => r.carteira));
}

export type BtgPerformanceComparison = {
  systemTwr: number;
  btgPublishedTwr: number;
  gapPctPoints: number;
  fromMonth: string;
  toMonth: string;
  note: string;
};

export function compareToBtgPublished(
  systemTwr: number,
  fromMonth: string,
  toMonth: string
): BtgPerformanceComparison | null {
  const btg = btgPublishedTwr(fromMonth, toMonth);
  if (btg == null) return null;
  return {
    systemTwr,
    btgPublishedTwr: btg,
    gapPctPoints: Math.round((systemTwr - btg) * 10000) / 100,
    fromMonth,
    toMonth,
    note:
      'BTG: retornos mensais oficiais (TWR da custódia). Sistema: patrimônio diário do livro + cotações.',
  };
}
