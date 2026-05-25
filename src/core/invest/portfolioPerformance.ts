import type { LedgerEvent } from './CustodyEngine';
import { isExternalCapitalFlow } from './flowClassification';
import type { LedgerTransactionType } from './ledgerTypes';
import type { PatrimonyAnchorFile } from './patrimonyAnchors';

export type ExternalFlowRow = {
  date: string;
  amount: number;
  operation: LedgerTransactionType;
};

export type PerformancePoint = {
  date: string;
  patrimony: number;
  externalFlow: number;
  /** Rentabilidade diária simples (patrimônio bruto). */
  dailyReturnSimple: number | null;
  /** Rentabilidade diária ajustada (fluxo externo removido). */
  dailyReturnAdjusted: number | null;
  /** Índice acumulado TWR (base 0 no 1º dia). */
  cumulativeReturnTwr: number | null;
};

export type PortfolioPerformanceResult = {
  from: string;
  to: string;
  startPatrimony: number;
  endPatrimony: number;
  /** Ganho econômico: patrimônio final − inicial − aportes + retiradas. */
  periodGainBrl: number;
  /** Retorno simples (patrimônio) — distorcido por aportes/retiradas. */
  periodReturnSimple: number;
  /** Retorno acumulado TWR (sub-períodos entre fluxos externos). */
  periodReturnTwr: number;
  /** Modified Dietz no período. */
  modifiedDietzReturn: number;
  totalExternalFlows: number;
  externalFlows: ExternalFlowRow[];
  points: PerformancePoint[];
  /** TWR por sub-períodos entre fechamentos mensais (âncoras BTG). */
  monthAnchorTwr?: number;
  monthAnchorBreakdown?: MonthAnchorReturn[];
  /** TWR da série diária (pode divergir — patrimônio calibrado/interpolado). */
  periodReturnTwrDaily?: number;
};

export type MonthAnchorReturn = {
  periodEnd: string;
  startPatrimony: number;
  endPatrimony: number;
  externalFlows: number;
  periodReturn: number;
};

/** Valor assinado do fluxo (+ entrada, − saída). */
export function signedExternalFlowAmount(event: Pick<LedgerEvent, 'transaction_type' | 'total_net_value'>): number {
  return Number(event.total_net_value ?? 0);
}

export function aggregateExternalFlowsByDate(
  entries: LedgerEvent[],
  from: string,
  to: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (!isExternalCapitalFlow(String(e.transaction_type))) continue;
    const day = String(e.transaction_date || '').slice(0, 10);
    if (!day || day < from || day > to) continue;
    map.set(day, Math.round(((map.get(day) ?? 0) + signedExternalFlowAmount(e)) * 100) / 100);
  }
  return map;
}

export function listExternalFlows(
  entries: LedgerEvent[],
  from: string,
  to: string
): ExternalFlowRow[] {
  const rows: ExternalFlowRow[] = [];
  for (const e of entries) {
    const op = String(e.transaction_type) as LedgerTransactionType;
    if (!isExternalCapitalFlow(op)) continue;
    const day = String(e.transaction_date || '').slice(0, 10);
    if (!day || day < from || day > to) continue;
    rows.push({
      date: day,
      amount: signedExternalFlowAmount(e),
      operation: op,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * TWR diário encadeado: em cada dia t, r_t = (V_t − V_{t−1} − CF_t) / V_{t−1},
 * com CF_t = capital_deposit/withdrawal (TED) no mesmo dia (fluxo no fim do pregão).
 * Dividendos, JCP, locação etc. permanecem no rendimento (não são CF externo).
 */
export function computePortfolioPerformance(
  series: Array<{ date: string; patrimony: number }>,
  entries: LedgerEvent[],
  from: string,
  to: string
): PortfolioPerformanceResult | null {
  if (!series.length) return null;

  const flowsByDate = aggregateExternalFlowsByDate(entries, from, to);
  const externalFlows = listExternalFlows(entries, from, to);
  const totalExternalFlows =
    Math.round(externalFlows.reduce((s, f) => s + f.amount, 0) * 100) / 100;

  const startPatrimony = series[0]!.patrimony;
  const endPatrimony = series[series.length - 1]!.patrimony;
  const periodGainBrl =
    Math.round((endPatrimony - startPatrimony - totalExternalFlows) * 100) / 100;
  const periodReturnSimple =
    startPatrimony > 0
      ? Math.round(((endPatrimony - startPatrimony) / startPatrimony) * 10000) / 10000
      : 0;

  const points: PerformancePoint[] = [];
  let cumulativeFactor = 1;
  let prevPatrimony: number | null = null;

  for (const p of series) {
    const externalFlow = flowsByDate.get(p.date) ?? 0;
    let dailyReturnSimple: number | null = null;
    let dailyReturnAdjusted: number | null = null;
    let cumulativeReturnTwr: number | null = null;

    if (prevPatrimony != null && prevPatrimony !== 0) {
      dailyReturnSimple = (p.patrimony - prevPatrimony) / prevPatrimony;
      dailyReturnAdjusted = (p.patrimony - prevPatrimony - externalFlow) / prevPatrimony;
      cumulativeFactor *= 1 + dailyReturnAdjusted;
      cumulativeReturnTwr = cumulativeFactor - 1;
    } else {
      cumulativeReturnTwr = 0;
    }

    points.push({
      date: p.date,
      patrimony: p.patrimony,
      externalFlow,
      dailyReturnSimple,
      dailyReturnAdjusted,
      cumulativeReturnTwr,
    });
    prevPatrimony = p.patrimony;
  }

  const periodReturnTwr =
    points.length > 0
      ? (points[points.length - 1]!.cumulativeReturnTwr ?? 0)
      : 0;

  const modifiedDietzReturn = computeModifiedDietz(
    startPatrimony,
    endPatrimony,
    externalFlows,
    from,
    to
  );

  return {
    from,
    to,
    startPatrimony,
    endPatrimony,
    periodGainBrl,
    periodReturnSimple,
    periodReturnTwr,
    modifiedDietzReturn,
    totalExternalFlows,
    externalFlows,
    points,
  };
}

/**
 * TWR encadeado entre patrimônios de fechamento mensal (âncoras BTG).
 * Ignora a série diária interpolada — útil para conferir com a tabela mensal do banco.
 */
export function computeTwrFromMonthEndAnchors(
  anchors: PatrimonyAnchorFile,
  entries: LedgerEvent[],
  from: string,
  to: string
): { periodReturnTwr: number; months: MonthAnchorReturn[] } | null {
  const ends = anchors.month_ends
    .filter((m) => m.date >= from && m.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (ends.length < 2) return null;

  const flowsByDate = aggregateExternalFlowsByDate(entries, from, to);
  const months: MonthAnchorReturn[] = [];
  let factor = 1;

  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1]!;
    const cur = ends[i]!;
    let externalFlows = 0;
    for (const [day, amt] of flowsByDate) {
      if (day > prev.date && day <= cur.date) externalFlows += amt;
    }
    externalFlows = Math.round(externalFlows * 100) / 100;
    const startPatrimony = prev.patrimony;
    const endPatrimony = cur.patrimony;
    const periodReturn =
      startPatrimony > 0
        ? (endPatrimony - startPatrimony - externalFlows) / startPatrimony
        : 0;
    factor *= 1 + periodReturn;
    months.push({
      periodEnd: cur.date,
      startPatrimony,
      endPatrimony,
      externalFlows,
      periodReturn,
    });
  }

  return {
    periodReturnTwr: factor - 1,
    months,
  };
}

/** Modified Dietz — peso pelo tempo restante no período (dia a dia). */
export function computeModifiedDietz(
  bmv: number,
  emv: number,
  flows: ExternalFlowRow[],
  from: string,
  to: string
): number {
  const days = dayCountInclusive(from, to);
  if (days <= 0 || bmv <= 0) return 0;

  let weightedFlows = 0;
  for (const f of flows) {
    const dayIndex = dayIndexInPeriod(f.date, from);
    const weight = (days - dayIndex) / days;
    weightedFlows += f.amount * weight;
  }

  const denominator = bmv + weightedFlows;
  if (denominator <= 0) return 0;

  const numerator = emv - bmv - flows.reduce((s, f) => s + f.amount, 0);
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function dayCountInclusive(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function dayIndexInPeriod(date: string, from: string): number {
  const start = new Date(`${from}T12:00:00Z`);
  const d = new Date(`${date}T12:00:00Z`);
  return Math.max(0, Math.floor((d.getTime() - start.getTime()) / 86400000));
}
