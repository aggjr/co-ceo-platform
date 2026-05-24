/**
 * Lançamentos provisórios de opções (custódia BTG) até chegada das notas.
 * Preço médio = coluna "Preço médio" do homebroker (mai/2026).
 */
import type { LedgerImportLine } from './ledgerTypes';
import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';

export const BROKER_SNAPSHOT_PENDING_DATE = '2026-05-23';
export const BROKER_SNAPSHOT_PENDING_EVENT_REF = `BROKER-SNAPSHOT-PENDING:${BROKER_SNAPSHOT_PENDING_DATE}`;
export const BROKER_SNAPSHOT_PENDING_SOURCE = 'broker_snapshot_pending_note';

type PendingOptionLine = {
  ticker: string;
  quantity: number;
  avgPrice: number;
};

function operationFor(ticker: string, quantity: number): LedgerImportLine['operation'] {
  const type = inferAssetType(ticker);
  if (type === 'option_call') return quantity < 0 ? 'call_sell' : 'call_buy';
  if (type === 'option_put') return quantity < 0 ? 'put_sell' : 'put_buy';
  return quantity < 0 ? 'sell' : 'buy';
}

function toImportLine(line: PendingOptionLine, leg: string): LedgerImportLine {
  const ticker = line.ticker.toUpperCase();
  const op = operationFor(ticker, line.quantity);
  const gross = Math.round(Math.abs(line.quantity) * line.avgPrice * 100) / 100;
  return {
    date: BROKER_SNAPSHOT_PENDING_DATE,
    ticker,
    operation: op,
    quantity: line.quantity,
    unit_price: line.avgPrice,
    total_net_value: gross,
    underlying_ticker: inferUnderlyingTicker(ticker),
    asset_type: inferAssetType(ticker),
    broker_note_ref: `${BROKER_SNAPSHOT_PENDING_EVENT_REF}:${ticker}#${leg}`,
    event_source_ref: BROKER_SNAPSHOT_PENDING_EVENT_REF,
    source_system: BROKER_SNAPSHOT_PENDING_SOURCE,
    counterparty: 'BTG Pactual',
    notes:
      'Custódia BTG (snapshot homebroker). Nota de corretagem pendente — conferir taxas e horário quando disponível.',
  };
}

/** Posições inteiras ausentes no livro (telas Opções BTG). */
export const BROKER_OPTIONS_MISSING_FULL: PendingOptionLine[] = [
  { ticker: 'ITUBF422', quantity: -300, avgPrice: 0.47 },
  { ticker: 'ITUBF427', quantity: 100, avgPrice: 0.37 },
  { ticker: 'ITUBF432', quantity: -700, avgPrice: 0.28 },
  { ticker: 'ITUBF437', quantity: -900, avgPrice: 0.21 },
  { ticker: 'ITUBF445', quantity: -700, avgPrice: 0.14 },
  { ticker: 'PRIOF755', quantity: -700, avgPrice: 1.04 },
  { ticker: 'PRIOF770', quantity: -900, avgPrice: 0.79 },
  { ticker: 'PRIOF775', quantity: -700, avgPrice: 0.95 },
  { ticker: 'PRIOF785', quantity: -500, avgPrice: 0.61 },
  { ticker: 'PRIOF800', quantity: -900, avgPrice: 0.6 },
  { ticker: 'PRIOF820', quantity: -700, avgPrice: 0.41 },
];

/** Complemento de qty (nota 19/05 incompleta vs custódia). */
export const BROKER_OPTIONS_TOP_UP: PendingOptionLine[] = [
  { ticker: 'PRIOF740', quantity: -300, avgPrice: 1.54 },
  { ticker: 'PRIOF760', quantity: -300, avgPrice: 1.23 },
];

/**
 * WEGER41 no livro com ticker legado; custódia BTG exibe WEGER441.
 * Encerra o legado e abre no código B3 atual (mesmo PM).
 */
export const BROKER_OPTIONS_WEGER_TICKER_MIGRATION: PendingOptionLine[] = [
  { ticker: 'WEGER41', quantity: 500, avgPrice: 0.38 },
  { ticker: 'WEGER441', quantity: -500, avgPrice: 0.38 },
];

export function buildBrokerOptionsPendingLedgerLines(): LedgerImportLine[] {
  const lines: LedgerImportLine[] = [];
  for (const row of BROKER_OPTIONS_MISSING_FULL) {
    lines.push(toImportLine(row, 'open'));
  }
  for (const row of BROKER_OPTIONS_TOP_UP) {
    lines.push(toImportLine(row, 'topup'));
  }
  for (const row of BROKER_OPTIONS_WEGER_TICKER_MIGRATION) {
    lines.push(toImportLine(row, 'wege-migrate'));
  }
  return lines;
}
