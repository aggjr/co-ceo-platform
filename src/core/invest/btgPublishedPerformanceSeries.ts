import { BTG_CARTEIRA_MONTHLY_2026 } from './btgPerformanceReference';
import type { PerformancePoint } from './portfolioPerformance';

function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function dayCountInclusive(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function monthReturnDecimal(monthKey: string): number | null {
  const row = BTG_CARTEIRA_MONTHLY_2026.find((r) => r.month === monthKey);
  return row?.carteira ?? null;
}

/**
 * Fator TWR acumulado (1 + r) entre `periodFrom` e `date`, usando retornos mensais
 * publicados pelo BTG. Dentro do mês, o retorno é rateado linearmente por dias
 * (aproximação para curva diária alinhada ao gráfico do homebroker).
 */
export function btgPublishedFactorAtDate(periodFrom: string, date: string): number {
  const from = periodFrom.slice(0, 10);
  const to = date.slice(0, 10);
  if (to <= from) return 1;

  let factor = 1;
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));

  while (y < endY || (y === endY && m <= endM)) {
    const mk = `${y}-${String(m).padStart(2, '0')}`;
    const r = monthReturnDecimal(mk);
    if (r != null) {
      const dim = daysInCalendarMonth(y, m);
      const monthStart = `${mk}-01`;
      const monthEnd = `${mk}-${String(dim).padStart(2, '0')}`;
      const segStart = from > monthStart ? from : monthStart;
      const segEnd = to < monthEnd ? to : monthEnd;
      if (segStart <= segEnd) {
        const spanDays = Math.max(1, dayCountInclusive(segStart, monthEnd) - 1);
        const elapsedDays = Math.max(0, dayCountInclusive(segStart, segEnd) - 1);
        const share = Math.min(1, elapsedDays / spanDays);
        factor *= 1 + r * share;
      }
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return Math.round(factor * 1_000_000_000_000) / 1_000_000_000_000;
}

/** Retorno acumulado TWR (decimal) no intervalo, com base nos meses publicados BTG. */
export function btgPublishedTwrBetween(from: string, to: string): number | null {
  const fromIso = from.slice(0, 10);
  const toIso = to.slice(0, 10);
  if (toIso < fromIso) return null;

  const fromMonth = fromIso.slice(0, 7);
  const toMonth = toIso.slice(0, 7);
  const hasData = BTG_CARTEIRA_MONTHLY_2026.some(
    (r) => r.month >= fromMonth && r.month <= toMonth
  );
  if (!hasData) return null;

  const factor = btgPublishedFactorAtDate(fromIso, toIso);
  return Math.round((factor - 1) * 10000) / 10000;
}

/** Pontos diários para gráfico/resumo (índice TWR acumulado). */
export function buildBtgPublishedDailyPerformancePoints(
  alignDates: string[],
  periodFrom: string
): PerformancePoint[] {
  const from = periodFrom.slice(0, 10);
  const points: PerformancePoint[] = [];

  for (const raw of alignDates) {
    const date = raw.slice(0, 10);
    if (date < from) continue;
    const factor = btgPublishedFactorAtDate(from, date);
    const cumulativeReturnTwr = Math.round((factor - 1) * 10000) / 10000;
    points.push({
      date,
      patrimony: 0,
      externalFlow: 0,
      dailyReturnSimple: null,
      dailyReturnAdjusted: null,
      cumulativeReturnTwr,
    });
  }

  return points;
}
