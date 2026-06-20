import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, SecurePayload, UserContext } from '../dal';
import { isoDateFromRow } from './isoDateFromRow';

const MONEY_TOL_CENTS = 1;
/** Tolerancia quando LIQ traz pregão B3 (rateio de taxas na nota). */
export const LIQ_PREGAO_TOLERANCE_CENTS = 1500;

export function matchSignedCentsSubset(
  candidateSignedCents: number[],
  targetSignedCents: number,
  toleranceCents = MONEY_TOL_CENTS
): boolean {
  return findSignedCentsSubsetIndices(candidateSignedCents, targetSignedCents, toleranceCents) !== null;
}

function findSignedCentsSubsetIndices(
  candidateSignedCents: number[],
  targetSignedCents: number,
  toleranceCents = MONEY_TOL_CENTS
): number[] | null {
  const n = candidateSignedCents.length;
  if (n === 0) return null;
  const sumAll = candidateSignedCents.reduce((sum, cents) => sum + cents, 0);
  if (Math.abs(sumAll - targetSignedCents) <= toleranceCents) {
    return candidateSignedCents.map((_, index) => index);
  }
  if (n > 20) return null;

  let best: number[] | null = null;
  let bestDelta = toleranceCents + 1;
  let ambiguous = false;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let sum = 0;
    const indices: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        sum += candidateSignedCents[i]!;
        indices.push(i);
      }
    }
    const delta = Math.abs(sum - targetSignedCents);
    if (delta <= toleranceCents) {
      if (delta < bestDelta) {
        bestDelta = delta;
        best = indices;
        ambiguous = false;
      } else if (delta === bestDelta) {
        ambiguous = true;
      }
    }
  }
  return ambiguous ? null : best;
}

/** Remove do pool os candidatos casados com um LIQ BOLSA (espelha baixa no apply). */
export function consumeSignedCentsSubset(
  candidateSignedCents: number[],
  targetSignedCents: number,
  toleranceCents = MONEY_TOL_CENTS
): { remaining: number[] } | null {
  const indices = findSignedCentsSubsetIndices(
    candidateSignedCents,
    targetSignedCents,
    toleranceCents
  );
  if (!indices) return null;
  const remove = new Set(indices);
  return {
    remaining: candidateSignedCents.filter((_, index) => !remove.has(index)),
  };
}

/** Consome subconjunto de entradas do pool LIQ (mesma logica de cents). */
export function consumePoolEntrySubset<T extends { cents: number }>(
  entries: T[],
  targetSignedCents: number,
  toleranceCents = MONEY_TOL_CENTS
): { remaining: T[] } | null {
  const indices = findSignedCentsSubsetIndices(
    entries.map((e) => e.cents),
    targetSignedCents,
    toleranceCents
  );
  if (!indices) return null;
  const remove = new Set(indices);
  return { remaining: entries.filter((_, index) => !remove.has(index)) };
}

export function liqBolsaBlockReason(
  candidateSignedCents: number[],
  _targetSignedCents: number
): string {
  if (!candidateSignedCents.length) {
    return 'Nenhum evento candidato encontrado para esta data de liquidacao.';
  }
  return 'Nenhum subconjunto de eventos casa com o valor do LIQ BOLSA.';
}

type BusinessEventCandidateRow = {
  id: string;
  source_ref?: string | null;
  event_kind?: string | null;
  occurred_on?: string | Date | null;
  settles_on?: string | Date | null;
  total_net?: number | string | null;
};

type FinancialLegRow = {
  id: string;
  account_id?: string | null;
  business_event_id?: string | null;
  transaction_date?: string | Date | null;
  settlement_date?: string | Date | null;
  direction?: 'in' | 'out' | string | null;
  amount?: number | string | null;
  status?: 'pending' | 'cleared' | 'cancelled' | string | null;
  external_ref?: string | null;
  metadata?: unknown;
};

type LiqBolsaCandidate = BusinessEventCandidateRow & {
  pendingCents: number;
  accountId: string;
  pendingLegIds: string[];
};

export type LiqBolsaMatchResult =
  | { status: 'matched'; settledEvents: string[]; totalCents: number }
  | {
      status: 'blocked';
      reason: string;
      candidates: unknown[];
      sumCents: number;
      deltaCents: number;
    };

export type LiqBolsaSettlementInput = {
  extractLineRef: string;
  settlementDate: string;
  valueSignedCents: number;
  accountId?: string;
  /** Pregao B3 (extrato LIQ) — restringe candidatos ao mesmo dia operacional. */
  tradeDate?: string;
};

function centsFromLeg(leg: FinancialLegRow): number {
  const sign = String(leg.direction) === 'out' ? -1 : 1;
  return Math.round(Number(leg.amount ?? 0) * 100) * sign;
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function liqToleranceCents(tradeDate?: string, targetCents = 0): number {
  if (!tradeDate) return MONEY_TOL_CENTS;
  const scaled = Math.max(
    LIQ_PREGAO_TOLERANCE_CENTS,
    Math.round(Math.abs(targetCents) * 0.005)
  );
  return Math.min(scaled, 50000);
}

function normalizePendingCentsForLiq(pendingCents: number, liqSignedCents: number): number {
  if (pendingCents === 0 || liqSignedCents === 0) return pendingCents;
  if (Math.sign(pendingCents) === Math.sign(liqSignedCents)) return pendingCents;
  return Math.sign(liqSignedCents) * Math.abs(pendingCents);
}

export class LiqBolsaSettlementService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async settle(
    ctx: UserContext,
    input: LiqBolsaSettlementInput
  ): Promise<LiqBolsaMatchResult> {
    const existing = await this.fetchExistingSettlement(ctx, input);
    if (existing) return existing;

    const candidates = await this.fetchCandidates(
      ctx,
      input.settlementDate,
      input.accountId,
      input.tradeDate
    );
    if (!candidates.length) {
      return {
        status: 'blocked',
        reason: 'Nenhum evento candidato encontrado para esta data de liquidacao.',
        candidates: [],
        sumCents: 0,
        deltaCents: Math.abs(input.valueSignedCents),
      };
    }

    const tol = liqToleranceCents(input.tradeDate, input.valueSignedCents);

    if (candidates.length === 1) {
      const only = candidates[0]!;
      const magDelta = Math.abs(Math.abs(only.pendingCents) - Math.abs(input.valueSignedCents));
      if (magDelta <= tol) {
        const aligned = {
          ...only,
          pendingCents: normalizePendingCentsForLiq(only.pendingCents, input.valueSignedCents),
        };
        return this.confirmSettlement(ctx, [aligned], input);
      }
    }

    const sumAll = candidates.reduce((sum, ev) => sum + ev.pendingCents, 0);
    if (Math.abs(sumAll - input.valueSignedCents) <= tol) {
      return this.confirmSettlement(ctx, candidates, input);
    }
    const magDelta = Math.abs(Math.abs(sumAll) - Math.abs(input.valueSignedCents));
    if (magDelta <= tol) {
      const aligned = candidates.map((ev) => ({
        ...ev,
        pendingCents: normalizePendingCentsForLiq(ev.pendingCents, input.valueSignedCents),
      }));
      return this.confirmSettlement(ctx, aligned, input);
    }

    const subset = this.findSubset(candidates, input.valueSignedCents, tol);
    if (subset) return this.confirmSettlement(ctx, subset, input);

    return {
      status: 'blocked',
      reason: 'Nenhum subconjunto de eventos casa com o valor do LIQ BOLSA.',
      candidates: candidates.map((ev) => ({
        eventId: ev.id,
        sourceRef: ev.source_ref,
        pendingCents: ev.pendingCents,
      })),
      sumCents: sumAll,
      deltaCents: Math.abs(sumAll - input.valueSignedCents),
    };
  }

  private async fetchCandidates(
    ctx: UserContext,
    settlementDate: string,
    accountId?: string,
    tradeDate?: string
  ): Promise<LiqBolsaCandidate[]> {
    // TODO [INVEST POLICY REFACTOR]:
    // Esta lista de `bolsaKinds` está hardcoded com os IDs legados das operações e dos `business_events` 
    // gerados no passado. No futuro, quando a infraestrutura de catalog for expandida com regras de liquidação,
    // o `InvestOperationPolicyService` deverá ser utilizado aqui para inferir dinamicamente
    // se o evento liquida em bolsa (ex: `policy.settlementMode === 'liq_bolsa'`).
    const bolsaKinds = new Set([
      'broker_note_spot',
      'broker_note_option',
      'broker_note_loan',
      'treasury_direct',
      'buy',
      'sell',
      'put_buy',
      'put_sell',
      'call_buy',
      'call_sell',
      'exercise',
      'assignment',
      'securities_lending',
      'brokerage_note',
    ]);
    const pendingLegRows = (await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      { status: 'pending' },
      { limit: 5000 }
    )) as FinancialLegRow[];

    const byEventId = new Map<string, { event: BusinessEventCandidateRow; legs: FinancialLegRow[] }>();
    for (const leg of pendingLegRows) {
      if (accountId && String(leg.account_id) !== accountId) continue;
      const settles = isoDateFromRow(leg.settlement_date ?? leg.transaction_date);
      if (!settles || settles !== settlementDate) continue;
      const eventId = String(leg.business_event_id ?? '');
      if (!eventId) continue;

      let bucket = byEventId.get(eventId);
      if (!bucket) {
        const event = (await this.gateway.findById(
          ctx,
          'business_events',
          eventId
        )) as BusinessEventCandidateRow | null;
        if (!event || !bolsaKinds.has(String(event.event_kind))) continue;
        if (tradeDate && isoDateFromRow(event.occurred_on) !== tradeDate) continue;
        bucket = { event, legs: [] };
        byEventId.set(eventId, bucket);
      }
      bucket.legs.push(leg);
    }

    const candidates: LiqBolsaCandidate[] = [];
    for (const { event, legs } of byEventId.values()) {
      const pendingCents = legs.reduce((sum, leg) => sum + centsFromLeg(leg), 0);
      if (pendingCents === 0) continue;
      const resolvedAccountId = accountId ?? String(legs[0]?.account_id ?? '');
      if (!resolvedAccountId) continue;
      candidates.push({
        ...event,
        pendingCents,
        accountId: resolvedAccountId,
        pendingLegIds: legs.map((leg) => String(leg.id)),
      });
    }

    return candidates.sort(
      (a, b) =>
        isoDateFromRow(a.occurred_on).localeCompare(isoDateFromRow(b.occurred_on)) ||
        String(a.source_ref ?? '').localeCompare(String(b.source_ref ?? '')) ||
        String(a.id).localeCompare(String(b.id))
    );
  }

  private async fetchExistingSettlement(
    ctx: UserContext,
    input: LiqBolsaSettlementInput
  ): Promise<LiqBolsaMatchResult | null> {
    const rows = (await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      { transaction_date: input.settlementDate, description: 'LIQ BOLSA' },
      { limit: 500 }
    )) as FinancialLegRow[];

    const matches = rows.filter((row) => {
      if (String(row.status) !== 'cleared') return false;
      if (input.accountId && String(row.account_id) !== input.accountId) return false;
      const metadata = parseMetadata(row.metadata);
      const extractRef = String(metadata.extract_line_ref ?? '');
      return (
        extractRef === input.extractLineRef ||
        String(row.external_ref || '').startsWith(`${input.extractLineRef}#`)
      );
    });
    if (!matches.length) return null;

    const totalCentsSigned = matches.reduce((sum, row) => sum + centsFromLeg(row), 0);
    if (Math.abs(totalCentsSigned - input.valueSignedCents) > MONEY_TOL_CENTS) return null;

    const settledEvents = matches
      .map((row) => String(parseMetadata(row.metadata).matched_business_event_id ?? row.business_event_id ?? ''))
      .filter(Boolean);

    return {
      status: 'matched',
      settledEvents,
      totalCents: Math.abs(totalCentsSigned),
    };
  }

  private findSubset(
    candidates: LiqBolsaCandidate[],
    targetCents: number,
    toleranceCents = MONEY_TOL_CENTS
  ): LiqBolsaCandidate[] | null {
    const n = candidates.length;
    if (n > 26) return null;

    let best: LiqBolsaCandidate[] | null = null;
    let bestDelta = toleranceCents + 1;
    let ambiguous = false;

    for (let mask = 1; mask < 1 << n; mask += 1) {
      let sum = 0;
      const subset: LiqBolsaCandidate[] = [];
      for (let i = 0; i < n; i += 1) {
        if (mask & (1 << i)) {
          sum += candidates[i]!.pendingCents;
          subset.push(candidates[i]!);
        }
      }
      const delta = Math.abs(sum - targetCents);
      if (delta <= toleranceCents) {
        if (delta < bestDelta) {
          bestDelta = delta;
          best = subset;
          ambiguous = false;
        } else if (delta === bestDelta) {
          ambiguous = true;
        }
      }
    }

    return best;
  }

  private async confirmSettlement(
    ctx: UserContext,
    matchedEvents: LiqBolsaCandidate[],
    input: LiqBolsaSettlementInput
  ): Promise<LiqBolsaMatchResult> {
    const settledEvents: string[] = [];
    for (const ev of matchedEvents) {
      const externalRef = `${input.extractLineRef}#${String(ev.source_ref ?? ev.id)}`;
      const existing = await this.gateway.findWhere(
        ctx,
        'financial_ledger_entries',
        { external_ref: externalRef },
        { limit: 1 }
      );
      if (!existing.length) {
        const payload: SecurePayload = {
          id: randomUUID(),
          account_id: input.accountId ?? ev.accountId,
          business_event_id: ev.id,
          transaction_date: input.settlementDate,
          settlement_date: input.settlementDate,
          amount: Math.abs(ev.pendingCents) / 100,
          direction: ev.pendingCents >= 0 ? 'in' : 'out',
          status: 'cleared',
          external_ref: externalRef,
          description: 'LIQ BOLSA',
          metadata: JSON.stringify({
            kind: 'liq_bolsa_settlement',
            extract_line_ref: input.extractLineRef,
            matched_business_event_id: ev.id,
            original_liq_bolsa_amount: input.valueSignedCents / 100,
          }),
        };
        await this.gateway.insert(ctx, 'financial_ledger_entries', payload);
      }
      await this.cancelPendingExpectation(ctx, ev.pendingLegIds);
      settledEvents.push(String(ev.id));
    }

    return {
      status: 'matched',
      settledEvents,
      totalCents: matchedEvents.reduce((sum, ev) => sum + Math.abs(ev.pendingCents), 0),
    };
  }

  private async cancelPendingExpectation(
    ctx: UserContext,
    pendingLegIds: string[]
  ): Promise<void> {
    for (const id of pendingLegIds) {
      const row = (await this.gateway.findById(
        ctx,
        'financial_ledger_entries',
        id
      )) as FinancialLegRow | null;
      if (!row || String(row.status) !== 'pending') continue;
      const metadata = parseMetadata(row.metadata);
      await this.gateway.update(ctx, 'financial_ledger_entries', id, {
        status: 'cancelled',
        metadata: JSON.stringify({
          ...metadata,
          cancelled_reason: 'settled_by_liq_bolsa',
        }),
      });
    }
  }
}
