import {
  btgLinesToImportEntries,
  type BtgExtractParseOptions,
} from '../BtgExtractLineParser';
import type {
  BrokerParseMetadata,
  BrokerParseResult,
  IBrokerExtractParser,
  ParsedBrokerEvent,
} from './IBrokerExtractParser';

function normalizeLines(rawContent: string): string[] {
  return rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function eventFromLine(line: ReturnType<typeof btgLinesToImportEntries>[number]): ParsedBrokerEvent {
  const ticker = String(line.ticker || '').trim().toUpperCase();
  const operation = String(line.operation || '').trim();
  const sourceRef = String(line.event_source_ref || `${line.date}:${operation}:${ticker}`);
  return {
    sourceRef,
    eventKind: operation,
    occurredOn: line.date,
    settlesOn: line.date,
    ticker,
    assetType: String(line.asset_type || ''),
    underlyingTicker: line.underlying_ticker ?? null,
    quantity: Number(line.quantity ?? 0),
    unitPrice: Number(line.unit_price ?? 0),
    totalNetValue: Number(line.total_net_value ?? 0),
    currency: 'BRL',
    brokerageRef: sourceRef,
    notes: line.notes ?? null,
    rawLine: null,
    metadata: {
      source_system: 'btg_extract_parser',
      extract_category: line.extract_category ?? null,
      applies_to_b3: line.applies_to_b3 ?? null,
    },
  };
}

export class BtgExtractParserAdapter implements IBrokerExtractParser {
  readonly brokerCode = 'BTG';
  readonly parserVersion = 'extract-v1';

  constructor(private readonly options: BtgExtractParseOptions = { includeLiqBolsa: true }) {}

  canParse(rawContent: string, meta?: BrokerParseMetadata): boolean {
    const filename = String(meta?.filename ?? '').toLowerCase();
    const sample = rawContent.slice(0, 2000).toUpperCase();
    return filename.includes('btg') ||
      sample.includes('BTG') ||
      sample.includes('LIQ BOLSA') ||
      sample.includes('SALDO ANTERIOR');
  }

  parse(rawContent: string): BrokerParseResult {
    const lines = normalizeLines(rawContent);
    const entries = btgLinesToImportEntries(lines, undefined, undefined, this.options);
    return {
      events: entries.map(eventFromLine),
      warnings: [],
      source: 'BTG_EXTRACT_V1',
    };
  }
}
