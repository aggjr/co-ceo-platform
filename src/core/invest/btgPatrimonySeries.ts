import type { DailyPatrimonyPoint, PatrimonyDailyResult } from './PatrimonyDailyEngine';
import type { LedgerEvent } from './CustodyEngine';
import {
  computePortfolioPerformance,
  computeTwrFromMonthEndAnchors,
} from './portfolioPerformance';
import { computeSharpeRatio, dailyReturnsFromPatrimony } from './sharpeRatio';
import { interpolatePatrimonyTarget, type PatrimonyAnchorFile } from './patrimonyAnchors';

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Curva suave BTG: interpolação linear entre fechamentos mensais de custódia. */
export function buildBtgInterpolatedPatrimonySeries(
  from: string,
  to: string,
  anchors: PatrimonyAnchorFile
): DailyPatrimonyPoint[] {
  const series: DailyPatrimonyPoint[] = [];
  let lastPatrimony: number | null = null;

  for (const date of enumerateDates(from, to)) {
    const patrimony = Math.round(interpolatePatrimonyTarget(date, anchors) * 100) / 100;
    let dailyReturn: number | null = null;
    if (lastPatrimony != null && lastPatrimony !== 0) {
      dailyReturn =
        Math.round(((patrimony - lastPatrimony) / lastPatrimony) * 10000) / 10000;
    }
    series.push({
      date,
      patrimony,
      patrimonyGross: patrimony,
      pendingSettlements: 0,
      scheduledCashPending: 0,
      cash: 0,
      positionsValue: patrimony,
      dailyReturn,
    });
    lastPatrimony = patrimony;
  }

  return series;
}

export function buildBtgAnchorPatrimonyDailyResult(
  entries: LedgerEvent[],
  from: string,
  to: string,
  anchors: PatrimonyAnchorFile,
  riskFreeAnnual = 0
): PatrimonyDailyResult {
  const series = buildBtgInterpolatedPatrimonySeries(from, to, anchors);
  const performanceDaily = computePortfolioPerformance(series, entries, from, to);
  const monthLinked = computeTwrFromMonthEndAnchors(anchors, entries, from, to);
  const performance = performanceDaily
    ? {
        ...performanceDaily,
        periodReturnTwrDaily: performanceDaily.periodReturnTwr,
        monthAnchorTwr: monthLinked?.periodReturnTwr,
        monthAnchorBreakdown: monthLinked?.months,
        /** TWR diário com ajuste de TEDs — usado no resumo e no gráfico. */
        periodReturnTwr: performanceDaily.periodReturnTwr,
        periodGainBrl: monthLinked
          ? Math.round(
              ((monthLinked.months[monthLinked.months.length - 1]?.endPatrimony ??
                performanceDaily.endPatrimony) -
                (monthLinked.months[0]?.startPatrimony ?? performanceDaily.startPatrimony) -
                performanceDaily.totalExternalFlows) *
                100
            ) / 100
          : performanceDaily.periodGainBrl,
      }
    : null;

  const returnsForSharpe =
    performance?.points
      .map((p) => p.dailyReturnAdjusted)
      .filter((r): r is number => r != null) ?? dailyReturnsFromPatrimony(series);
  const sharpe = computeSharpeRatio(returnsForSharpe, { riskFreeAnnual });

  return {
    from,
    to,
    series,
    sharpe,
    performance,
    meta: {
      method: 'mtm_btg_calibrated',
      stock_cash_settlement_days: 0,
      note:
        'Patrimônio diário: interpolação entre fechamentos mensais BTG (custódia). ' +
        'TWR: fluxos externos apenas capital_deposit/withdrawal (TEDs).',
    },
  };
}
