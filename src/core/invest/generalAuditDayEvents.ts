import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType, isFixedIncomeTicker } from './assetClassifier';
import { AUTO_D2_REF_PREFIX } from './AutoPendingSettlementSync';

export type GeneralAuditDayEvents = {
  eventCount: number;
  notesSummary: string;
  extractSummary: string;
  businessSummary: string;
  orphanSummary: string;
  cashAssetSummary: string;
  cashPureSummary: string;
  transitSummary: string;
  status: 'ok' | 'warn' | 'error';
  statusLabel: string;
};

function roundMoney(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r) < 0.005 ? 0 : r;
}

function detailList(lines: string[], max = 12): string {
  if (!lines.length) return '';
  const head = lines.slice(0, max);
  const tail = lines.length > max ? ` (+${lines.length - max})` : '';
  return head.join(' · ') + tail;
}

function isCashTicker(ticker: string, assetType?: string): boolean {
  const t = ticker.toUpperCase();
  return assetType === 'cash' || t === 'CAIXA' || t.startsWith('CAIXA-');
}

function isPendingSettlementClear(e: LedgerEvent): boolean {
  return (
    String(e.transaction_type) === 'pending_settlement' &&
    String(e.broker_note_ref || '').endsWith(':CLEAR')
  );
}

function isBusinessTrade(e: LedgerEvent): boolean {
  const type = String(e.transaction_type);
  return ['buy', 'sell', 'put_buy', 'put_sell', 'call_buy', 'call_sell', 'option_exercise'].includes(
    type
  );
}

function tradeSignedCash(e: LedgerEvent): number {
  const type = String(e.transaction_type);
  const abs = Math.abs(Number(e.total_net_value ?? 0));
  if (['buy', 'put_buy', 'call_buy'].includes(type)) return -abs;
  if (['sell', 'put_sell', 'call_sell'].includes(type)) return abs;
  return Number(e.total_net_value ?? 0);
}

function eventCashValue(e: LedgerEvent): number {
  if (!isCashTicker(String(e.asset_ticker || ''), String(e.asset_type || ''))) return 0;
  return Number(e.total_net_value ?? 0);
}

function dailyBusinessCashValue(e: LedgerEvent): number {
  if (isPendingSettlementClear(e)) return 0;
  return eventCashValue(e);
}

function formatEventLine(e: LedgerEvent): string {
  const ticker = String(e.asset_ticker || '').toUpperCase();
  const type = String(e.transaction_type);
  const qty = Number(e.quantity ?? 0);
  const net = roundMoney(Number(e.total_net_value ?? 0));
  if (isCashTicker(ticker, String(e.asset_type || ''))) {
    return `${type} ${ticker} ${net >= 0 ? '+' : ''}${net.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  }
  const qtyPart = Math.abs(qty) >= 0.000001 ? ` ${Math.abs(qty)}` : '';
  return `${type} ${ticker}${qtyPart} ${net >= 0 ? '+' : ''}${net.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
}

function isExtractOrigin(e: LedgerEvent): boolean {
  const ref = String(e.broker_note_ref || '').toUpperCase();
  if (ref.startsWith('BTG-EXT')) return true;
  if (ref.startsWith('BTG-TD:') || ref.startsWith('BTG-LIQ')) return true;
  const notes = String(e.notes || '').toUpperCase();
  if (/LIQ\s+BOLSA|EXTRATO|TESOURO DIRETO|TED\s/i.test(notes)) return true;
  return false;
}

function isNoteOrigin(e: LedgerEvent): boolean {
  if (isExtractOrigin(e)) return false;
  const ref = String(e.broker_note_ref || '');
  if (/^\d{5,}/.test(ref)) return true;
  if (/^BTG-\d/.test(ref)) return true;
  const notes = String(e.notes || '').toUpperCase();
  if (/NOTA\s+DE\s+CORRETAGEM|B3|LIQ\s+BOLSA/i.test(notes) && !isExtractOrigin(e)) {
    return !ref.startsWith('BTG-EXT');
  }
  return false;
}

function summarizeBusinessGroups(
  groups: Map<string, LedgerEvent[]>,
  unlinked: LedgerEvent[]
): Pick<
  GeneralAuditDayEvents,
  | 'businessSummary'
  | 'orphanSummary'
  | 'status'
  | 'statusLabel'
  | 'eventCount'
> {
  let bothSidesEvents = 0;
  let financialOnlyEvents = 0;
  let assetOnlyEvents = 0;
  let twoSidedExpectedCash = 0;
  let twoSidedFinancialCash = 0;
  let twoSidedFeeAdjust = 0;
  const explanations: string[] = [];
  const unlinkedExplanation: string[] = [];

  for (const [eventId, legs] of groups) {
    const assetLegs = legs.filter((e) => !isCashTicker(String(e.asset_ticker || ''), String(e.asset_type || '')));
    const cashLegs = legs.filter((e) => isCashTicker(String(e.asset_ticker || ''), String(e.asset_type || '')));
    const hasAsset = assetLegs.length > 0;
    const hasCash = cashLegs.some((e) => Math.abs(dailyBusinessCashValue(e)) > 0.005);
    const expectedCash = roundMoney(
      assetLegs.filter(isBusinessTrade).reduce((sum, e) => sum + tradeSignedCash(e), 0)
    );
    const feeAdj = roundMoney(
      legs
        .filter((e) => String(e.transaction_type) === 'cost_adjustment')
        .reduce((sum, e) => sum + Number(e.total_net_value ?? 0), 0)
    );
    const actualCash = roundMoney(cashLegs.reduce((sum, e) => sum + dailyBusinessCashValue(e), 0));
    if (hasAsset && hasCash) {
      bothSidesEvents += 1;
      twoSidedExpectedCash += expectedCash;
      twoSidedFinancialCash += actualCash;
      twoSidedFeeAdjust += feeAdj;
    } else if (hasCash) financialOnlyEvents += 1;
    else if (hasAsset) assetOnlyEvents += 1;

    const tickers = [...new Set(assetLegs.map((e) => String(e.asset_ticker || '').toUpperCase()))].join(',');
    const ops = [...new Set(legs.map((e) => String(e.transaction_type)))].join(',');
    explanations.push(
      `${eventId.slice(0, 8)} ${tickers || 'financeiro'} ${ops}: ativo ${expectedCash.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, caixa ${actualCash.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
    );
  }

  for (const e of unlinked) {
    unlinkedExplanation.push(formatEventLine(e));
  }

  const eventCashDelta = roundMoney(
    twoSidedFinancialCash - (twoSidedExpectedCash + twoSidedFeeAdjust)
  );
  let status: GeneralAuditDayEvents['status'] = 'ok';
  if (unlinked.length > 0 || Math.abs(eventCashDelta) > 0.05) status = 'error';
  else if (assetOnlyEvents > 0 || financialOnlyEvents > 0) status = 'warn';

  const findingParts: string[] = [];
  if (unlinked.length > 0) findingParts.push(`${unlinked.length} sem business_event`);
  if (Math.abs(eventCashDelta) > 0.05) {
    findingParts.push(`Δ caixa ${eventCashDelta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  }
  if (assetOnlyEvents > 0) findingParts.push(`${assetOnlyEvents} só ativo`);
  if (financialOnlyEvents > 0) findingParts.push(`${financialOnlyEvents} só financeiro`);

  return {
    eventCount: groups.size + unlinked.length,
    businessSummary: detailList(explanations, 10),
    orphanSummary: detailList(unlinkedExplanation, 8),
    status,
    statusLabel: status === 'ok' ? 'OK' : status === 'warn' ? 'Atenção' : 'Erro',
  };
}

export function summarizeGeneralAuditDayEvents(dayEvents: LedgerEvent[]): GeneralAuditDayEvents {
  const movement = dayEvents.filter(
    (e) => String(e.transaction_type) !== 'opening_balance' && !isPendingSettlementClear(e)
  );

  const noteLines: string[] = [];
  const extractLines: string[] = [];
  const assetCashLines: string[] = [];
  const pureCashLines: string[] = [];
  const transitLines: string[] = [];

  const businessGroups = new Map<string, LedgerEvent[]>();
  const unlinked: LedgerEvent[] = [];
  const eventHasAsset = new Set<string>();

  for (const e of movement) {
    if (e.business_event_id) {
      const id = String(e.business_event_id);
      const ticker = String(e.asset_ticker || '').toUpperCase();
      const assetType = String(e.asset_type || inferAssetType(ticker));
      if (!isCashTicker(ticker, assetType)) eventHasAsset.add(id);
    }
  }

  for (const e of movement) {
    if (e.business_event_id) {
      const id = String(e.business_event_id);
      businessGroups.set(id, [...(businessGroups.get(id) || []), e]);
    } else {
      unlinked.push(e);
    }

    const line = formatEventLine(e);
    if (isExtractOrigin(e)) extractLines.push(line);
    else if (isNoteOrigin(e)) noteLines.push(line);

    const ticker = String(e.asset_ticker || '').toUpperCase();
    const assetType = String(e.asset_type || inferAssetType(ticker));
    const txType = String(e.transaction_type);
    const isCash = isCashTicker(ticker, assetType);

    if (isCash) {
      const value = Number(e.total_net_value ?? 0);
      if (txType === 'pending_settlement') {
        const rawRef = String(e.broker_note_ref || e.id || '');
        if (rawRef.startsWith(AUTO_D2_REF_PREFIX)) {
          if (rawRef.endsWith(':CLEAR')) {
            transitLines.push(`${rawRef}: baixa trânsito`);
          } else {
            transitLines.push(`${rawRef}: ${value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
          }
        } else {
          const linked =
            Boolean(e.business_event_id && eventHasAsset.has(String(e.business_event_id))) ||
            isBusinessTrade(e);
          if (linked) assetCashLines.push(line);
          else pureCashLines.push(line);
        }
      } else {
        const linked =
          Boolean(e.business_event_id && eventHasAsset.has(String(e.business_event_id))) ||
          isBusinessTrade(e);
        if (linked) assetCashLines.push(line);
        else pureCashLines.push(line);
      }
    } else if (!isFixedIncomeTicker(ticker) && assetType !== 'fixed_income') {
      // patrimonio movement already in business groups
    }
  }

  const biz = summarizeBusinessGroups(businessGroups, unlinked);

  return {
    eventCount: movement.length,
    notesSummary: detailList(noteLines, 8),
    extractSummary: detailList(extractLines, 8),
    businessSummary: biz.businessSummary,
    orphanSummary: biz.orphanSummary,
    cashAssetSummary: detailList(assetCashLines, 6),
    cashPureSummary: detailList(pureCashLines, 6),
    transitSummary: detailList(transitLines, 6),
    status: biz.status,
    statusLabel: biz.statusLabel,
  };
}

export function buildGeneralAuditDayEventsByDate(
  events: LedgerEvent[],
  days: string[]
): Map<string, GeneralAuditDayEvents> {
  const byDate = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    const d = String(e.transaction_date || '').slice(0, 10);
    if (!d) continue;
    byDate.set(d, [...(byDate.get(d) || []), e]);
  }

  const out = new Map<string, GeneralAuditDayEvents>();
  for (const day of days) {
    out.set(day, summarizeGeneralAuditDayEvents(byDate.get(day) || []));
  }
  return out;
}
