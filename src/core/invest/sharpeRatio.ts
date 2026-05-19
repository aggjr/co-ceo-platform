/** Retornos diários em decimal (ex.: 0.01 = 1%). */
export function dailyReturnsFromPatrimony(series: Array<{ patrimony: number }>): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.patrimony;
    const cur = series[i]!.patrimony;
    if (prev <= 0 || !Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    out.push((cur - prev) / prev);
  }
  return out;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v =
    values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export type SharpeResult = {
  sharpe: number | null;
  annualized: boolean;
  tradingDaysPerYear: number;
  riskFreeAnnual: number;
  observationDays: number;
  meanDailyReturn: number;
  stdDailyReturn: number;
  reason?: string;
};

/**
 * Sharpe anualizado (252 du): (média diária − rf/252) / desvio × √252.
 */
export function computeSharpeRatio(
  dailyReturns: number[],
  options?: { riskFreeAnnual?: number; tradingDaysPerYear?: number }
): SharpeResult {
  const tradingDaysPerYear = options?.tradingDaysPerYear ?? 252;
  const riskFreeAnnual = options?.riskFreeAnnual ?? 0;
  const rfDaily = riskFreeAnnual / tradingDaysPerYear;

  if (dailyReturns.length < 2) {
    return {
      sharpe: null,
      annualized: true,
      tradingDaysPerYear,
      riskFreeAnnual,
      observationDays: dailyReturns.length,
      meanDailyReturn: 0,
      stdDailyReturn: 0,
      reason: 'Menos de 2 dias com retorno válido.',
    };
  }

  const meanR = mean(dailyReturns);
  const stdR = sampleStd(dailyReturns);

  if (stdR === 0 || !Number.isFinite(stdR)) {
    return {
      sharpe: null,
      annualized: true,
      tradingDaysPerYear,
      riskFreeAnnual,
      observationDays: dailyReturns.length,
      meanDailyReturn: meanR,
      stdDailyReturn: stdR,
      reason: 'Desvio diário zero — série constante.',
    };
  }

  const sharpe =
    ((meanR - rfDaily) / stdR) * Math.sqrt(tradingDaysPerYear);

  return {
    sharpe: Math.round(sharpe * 1000) / 1000,
    annualized: true,
    tradingDaysPerYear,
    riskFreeAnnual,
    observationDays: dailyReturns.length,
    meanDailyReturn: Math.round(meanR * 1e6) / 1e6,
    stdDailyReturn: Math.round(stdR * 1e6) / 1e6,
  };
}
