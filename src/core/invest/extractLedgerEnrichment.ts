import type { LedgerEvent } from './CustodyEngine';

/** Normaliza chave de nota para cruzar caixa ↔ patrimônio. */
export function normalizeBrokerNoteRef(ref: string | null | undefined): string | null {
  const r = String(ref || '').trim();
  if (!r) return null;
  let s = r.replace(/^BROKER_REF:/i, '');
  s = s.replace(/:CASH$/i, '');
  return s || null;
}

export type TradeNoteSummary = {
  netValue: number;
  tickers: Set<string>;
  tradeDate: string;
  settlementDate: string;
};

export type CostAdjustmentHint = {
  date: string;
  ticker: string;
  amount: number;
};

/** Mapa ref normalizada → resumo da nota (pernas patrimoniais). */
export function buildNotesTradeSummary(
  tradeEvents: LedgerEvent[],
  addDays: (dateStr: string, days: number) => string
): Map<string, TradeNoteSummary> {
  const notesTradeSummary = new Map<string, TradeNoteSummary>();

  for (const e of tradeEvents) {
    const ref = normalizeBrokerNoteRef(e.broker_note_ref);
    if (!ref || !e.transaction_date) continue;
    const t = e.asset_ticker?.toUpperCase() || '';
    const isOptionsOrFixed =
      e.asset_type === 'option_call' ||
      e.asset_type === 'option_put' ||
      t.startsWith('LFT') ||
      t.startsWith('CDB') ||
      t.startsWith('LTN') ||
      t.startsWith('NTN');
    const daysToSettle = isOptionsOrFixed ? 1 : 2;
    const settlement = addDays(e.transaction_date, daysToSettle);

    let summary = notesTradeSummary.get(ref);
    if (!summary) {
      summary = {
        netValue: 0,
        tickers: new Set(),
        tradeDate: e.transaction_date,
        settlementDate: settlement,
      };
      notesTradeSummary.set(ref, summary);
    }
    summary.netValue += e.total_net_value;
    if (e.asset_ticker) summary.tickers.add(e.asset_ticker);
    if (settlement > summary.settlementDate) {
      summary.settlementDate = settlement;
    }
  }
  return notesTradeSummary;
}

/** Taxas/custódia no patrimônio (cost_adjustment) por data+valor. */
export function buildCostAdjustmentIndex(
  tradeEvents: LedgerEvent[]
): Map<string, CostAdjustmentHint[]> {
  const byDate = new Map<string, CostAdjustmentHint[]>();
  for (const e of tradeEvents) {
    if (String(e.transaction_type) !== 'fee') continue;
    const ticker = String(e.asset_ticker || '').toUpperCase();
    if (!ticker || ticker.startsWith('CAIXA')) continue;
    const amt = Math.round(Math.abs(Number(e.total_net_value ?? 0)) * 100) / 100;
    if (amt <= 0) continue;
    const date = String(e.transaction_date || '');
    const list = byDate.get(date) || [];
    list.push({ date, ticker, amount: amt });
    byDate.set(date, list);
  }
  return byDate;
}

const TICKER_IN_TEXT =
  /\b(PRIO3|PRIO[A-Z0-9]{2,6}|ITUB[A-Z0-9]{2,6}|BBAS[A-Z0-9]{2,6}|WEGE[A-Z0-9]{2,6}|LFT-\d{8})\b/i;

/** Infere ativo e data operação a partir da descrição do extrato. */
export function inferFromCashDescription(
  description: string,
  cashDate: string
): { ticker: string; originDate: string } | null {
  const d = String(description || '');
  const upper = d.toUpperCase();

  if (/LFT|TESOURO\s+DIRETO|TESOURO\b/i.test(upper)) {
    const m = upper.match(/LFT[-\s]?(\d{2})\/(\d{2})\/(\d{4})/);
    const ticker = m
      ? `LFT-${m[3]}${m[2]}${m[1]}`
      : 'LFT-20310301';
    const pregao = d.match(/Preg[aã]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const originDate = pregao
      ? `${pregao[3]}-${pregao[2]}-${pregao[1]}`
      : cashDate;
    return { ticker, originDate };
  }

  if (/BTC|ALUGUEL|LOCAÇÃO|LOCACAO/i.test(upper)) {
    const tm = upper.match(TICKER_IN_TEXT);
    const ticker = tm ? tm[1].toUpperCase() : 'PRIO3';
    const pregao = d.match(/Preg[aã]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const originDate = pregao
      ? `${pregao[3]}-${pregao[2]}-${pregao[1]}`
      : cashDate;
    return { ticker, originDate };
  }

  if (/IR\s*-\s*BTC|CORRETAGEM\s+BTC/i.test(upper)) {
    const tm = upper.match(TICKER_IN_TEXT);
    return {
      ticker: tm ? tm[1].toUpperCase() : 'PRIO3',
      originDate: cashDate,
    };
  }

  if (/IRRF.*OPCAO|OPÇÃO|OPCAO/i.test(upper)) {
    return { ticker: 'Opções (IRRF mensal)', originDate: cashDate };
  }

  if (/CUST[ÓO]DIA|LIQ\s+BOLSA.*TAXA/i.test(upper)) {
    return { ticker: 'Carteira RV (custódia)', originDate: cashDate };
  }

  const ordem = d.match(
    /(?:Ordem\s+[CV]\s*[—–-]\s*|[-\u2013\u2014]\s*)([A-Z]{4}[A-X][A-Z0-9]{0,6}E?)/i
  );
  if (ordem) {
    const ticker = ordem[1].replace(/E$/i, '').toUpperCase();
    const pregao = d.match(/Preg[aã]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const originDate = pregao
      ? `${pregao[3]}-${pregao[2]}-${pregao[1]}`
      : cashDate;
    return { ticker, originDate };
  }

  const tm = d.match(TICKER_IN_TEXT);
  if (tm) {
    return { ticker: tm[1].toUpperCase(), originDate: cashDate };
  }

  return null;
}

/** Evita exibir saldo inicial duplicado (manual + extrato). */
export function isDuplicateManualOpeningCash(
  ce: LedgerEvent,
  cashEvents: LedgerEvent[]
): boolean {
  if (ce.transaction_type !== 'opening_balance') return false;
  const ref = normalizeBrokerNoteRef(ce.broker_note_ref);
  if (ref?.includes('BTG-EXTRATO-OPENING')) return false;
  const amt = Math.abs(Number(ce.total_net_value ?? 0));
  const hasExtrato = cashEvents.some((o) => {
    if (o.id === ce.id) return false;
    const r = normalizeBrokerNoteRef(o.broker_note_ref);
    if (!r?.includes('BTG-EXTRATO-OPENING')) return false;
    return (
      o.transaction_date === ce.transaction_date &&
      Math.abs(Math.abs(Number(o.total_net_value ?? 0)) - amt) < 0.02
    );
  });
  return hasExtrato;
}
