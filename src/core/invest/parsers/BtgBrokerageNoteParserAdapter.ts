import {
  aggregateNoteFees,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
  type BtgBrokerageNoteTrade,
} from '../btgBrokerageNoteParser';
import { inferAssetType } from '../assetClassifier';
import type {
  BrokerParseMetadata,
  BrokerParseResult,
  IBrokerExtractParser,
  ParsedBrokerEvent,
} from './IBrokerExtractParser';

function tradeOperation(trade: BtgBrokerageNoteTrade): string {
  const assetType = inferAssetType(trade.ticker);
  if (assetType === 'option_call') return trade.side === 'V' ? 'call_sell' : 'call_buy';
  if (assetType === 'option_put') return trade.side === 'V' ? 'put_sell' : 'put_buy';
  return trade.side === 'V' ? 'sell' : 'buy';
}

function eventFromTrade(note: BtgBrokerageNote, trade: BtgBrokerageNoteTrade, index: number): ParsedBrokerEvent {
  const op = tradeOperation(trade);
  const assetType = inferAssetType(trade.ticker);
  const fees = aggregateNoteFees(note);
  return {
    sourceRef: `${note.dedupeKey}:T${index + 1}`,
    eventKind: op,
    occurredOn: note.pregaoDate,
    settlesOn: note.pregaoDate,
    ticker: trade.ticker,
    assetType,
    underlyingTicker: trade.underlyingStock || null,
    quantity: trade.quantity,
    unitPrice: trade.unitPrice,
    totalNetValue: trade.grossValue,
    currency: 'BRL',
    brokerageRef: note.dedupeKey,
    notes: `${note.noteNumber} ${trade.operationLabel}`.trim(),
    rawLine: null,
    metadata: {
      note_number: note.noteNumber,
      note_category: note.category,
      gross_value: trade.grossValue,
      fees_total_debit: fees.totalDebit,
    },
  };
}

export class BtgBrokerageNoteParserAdapter implements IBrokerExtractParser {
  readonly brokerCode = 'BTG';
  readonly parserVersion = 'brokerage-note-v1';

  canParse(rawContent: string, meta?: BrokerParseMetadata): boolean {
    const filename = String(meta?.filename ?? '').toLowerCase();
    const sample = rawContent.slice(0, 3000).toUpperCase();
    return filename.endsWith('.pdf') ||
      sample.includes('NOTA DE CORRETAGEM') ||
      sample.includes('BTG PACTUAL') ||
      sample.includes('NECTON');
  }

  parse(rawContent: string, meta?: BrokerParseMetadata): BrokerParseResult {
    const lines = rawContent.split(/\r?\n/);
    const notes = parseBtgBrokerageNoteBlocks(lines, meta?.filename ?? 'raw-content');
    const events = notes.flatMap((note) =>
      note.trades.map((trade, index) => eventFromTrade(note, trade, index))
    );
    return {
      events,
      warnings: notes.length ? [] : ['Nenhuma nota BTG reconhecida no conteudo informado.'],
      source: 'BTG_BROKERAGE_NOTE_V1',
    };
  }
}
