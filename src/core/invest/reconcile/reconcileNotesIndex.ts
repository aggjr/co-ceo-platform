import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
} from '../btgBrokerageNoteParser';
import { brokerageNotesToLedgerLines } from '../btgBrokerageNoteLedgerTranslator';
import { pdfBufferToLines } from '../btgPdfTextExtract';
import type { BtgUploadFileInput } from '../btgUploadImportService';
import type { LedgerImportLine } from '../ledgerTypes';

export type NoteFilePreviewRow = {
  rowKey: string;
  noteNumber: string;
  pregaoDate: string;
  ticker: string;
  quantity: number;
  unitPrice: number;
  operation: string;
  status: 'file_only';
};

function decodeFile(file: BtgUploadFileInput): Buffer {
  return Buffer.from(file.contentBase64, 'base64');
}

function fileNameFromPath(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || name;
}

function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

function bareNoteNumber(ref: string | undefined): string {
  const r = String(ref || '');
  const m = r.match(/(\d{4,})/);
  return m ? m[1] : r.replace(/^BTG-NOTA-?/i, '') || '—';
}

export function noteRowKey(noteNumber: string, pregaoDate: string, lineNo: number): string {
  return `note:${noteNumber}:${pregaoDate}:${lineNo}`;
}

export async function buildNotesFileIndex(files: BtgUploadFileInput[]): Promise<{
  calendar: string[];
  noteLinesByDate: Record<string, NoteFilePreviewRow[]>;
  linesByRowKey: Map<string, LedgerImportLine>;
}> {
  const allNotes: BtgBrokerageNote[] = [];
  for (const file of files) {
    const fileName = fileNameFromPath(file.name);
    if (!isPdfName(fileName)) continue;
    const buf = decodeFile(file);
    const lines = await pdfBufferToLines(buf);
    allNotes.push(...parseBtgBrokerageNoteBlocks(lines, file.name));
  }

  const { kept } = dedupeBrokerageNotes(allNotes);
  const importLines = brokerageNotesToLedgerLines(kept);
  const linesByRowKey = new Map<string, LedgerImportLine>();
  const noteLinesByDate: Record<string, NoteFilePreviewRow[]> = {};
  const lineNoByNoteDate = new Map<string, number>();

  importLines.forEach((line, i) => {
    const pregaoDate = String(line.date || '').slice(0, 10);
    if (!pregaoDate) return;
    const noteNum = bareNoteNumber(line.broker_note_ref);
    const bucket = `${noteNum}|${pregaoDate}`;
    const lineNo = (lineNoByNoteDate.get(bucket) || 0) + 1;
    lineNoByNoteDate.set(bucket, lineNo);
    const rowKey = noteRowKey(noteNum, pregaoDate, lineNo);
    linesByRowKey.set(rowKey, line);
    const previewRow: NoteFilePreviewRow = {
      rowKey,
      noteNumber: noteNum,
      pregaoDate,
      ticker: String(line.ticker || '').toUpperCase(),
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      operation: String(line.operation),
      status: 'file_only',
    };
    if (!noteLinesByDate[pregaoDate]) noteLinesByDate[pregaoDate] = [];
    noteLinesByDate[pregaoDate].push(previewRow);
    void i;
  });

  const calendar = Object.keys(noteLinesByDate).sort();
  return { calendar, noteLinesByDate, linesByRowKey };
}
