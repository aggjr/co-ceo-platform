import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';

export type InvestPeriodBounds = {
  today: string;
  /** Início padrão de filtros (abertura do livro ou primeiro lançamento). */
  defaultFrom: string;
  /** Limite inferior selecionável em telas com período. */
  periodMin: string;
  openingDate: string | null;
  /** Ação de referência no gráfico; null se não houver custódia nem env. */
  chartBenchmarkTicker: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isEquityTickerForBenchmark(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return /^[A-Z]{4}(3|4|8|11)$/.test(t);
}

/**
 * Limites de período e benchmark derivados do livro razão da organização.
 * Sem datas nem tickers fixos no código.
 */
export function resolveInvestPeriodBounds(events: LedgerEvent[]): InvestPeriodBounds {
  const today = todayIso();
  let openingDate: string | null = null;
  let minDate: string | null = null;

  for (const e of events) {
    const d = String(e.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!minDate || d < minDate) minDate = d;
    if (e.type === 'opening_balance') {
      if (!openingDate || d < openingDate) openingDate = d;
    }
  }

  const defaultFrom = openingDate ?? minDate ?? today;
  const periodMin = minDate ?? defaultFrom;

  const envTicker = (process.env.INVEST_CHART_BENCHMARK_TICKER ?? '').trim().toUpperCase();
  let chartBenchmarkTicker: string | null = envTicker || null;

  if (!chartBenchmarkTicker) {
    const custody = rebuildCustodyFromLedger(events);
    let bestTicker = '';
    let bestScore = 0;
    for (const pos of custody.assets) {
      const t = String(pos.underlying || pos.ticker || '')
        .trim()
        .toUpperCase();
      if (!isEquityTickerForBenchmark(t)) continue;
      const score = Math.abs(Number(pos.quantity) || 0) * (Number(pos.avgPrice) || 0);
      if (score > bestScore) {
        bestScore = score;
        bestTicker = t;
      }
    }
    chartBenchmarkTicker = bestTicker || null;
  }

  return {
    today,
    defaultFrom,
    periodMin,
    openingDate,
    chartBenchmarkTicker,
  };
}
