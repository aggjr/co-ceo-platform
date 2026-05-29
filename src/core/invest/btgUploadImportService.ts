/**
 * Importação de extrato e notas BTG via upload (PDF/TXT/CSV) → livro razão.
 */
import type { UserContext } from '../dal';
import { GatewayError } from '../dal';
import { btgLinesToImportEntries } from './BtgExtractLineParser';
import { btgExtractCsvToNormalizedLines } from './btgExtractCsv';
import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
} from './btgBrokerageNoteParser';
import { brokerageNotesToLedgerLines } from './btgBrokerageNoteLedgerTranslator';
import { suppressBrokerageNoteCashLines } from './btgBrokerageNoteLedgerTranslator';
import { normalizeBtgExtractPdfText } from './btgExtractPdfText';
import { pdfBufferToLines, pdfBufferToText } from './btgPdfTextExtract';
import { LedgerImportService } from './LedgerImportService';
import type { LedgerImportLine, LedgerTransactionType } from './ledgerTypes';
import {
  extractMovementBlock,
  lastExtractCashPoint,
  parseExtractCashSeries,
} from './btgExtractCashSeries';
import {
  batchChainIntact,
  buildExtractReconcileFields,
  sortParsedExtracts,
  type ParsedExtractForBatch,
} from './btgExtractBatchReconcile';
import type { LedgerEvent } from './CustodyEngine';

const DEFAULT_OPENING_BALANCE = 58_758.79;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type BtgUploadFileInput = {
  /** Caminho relativo (pasta/arquivo) vindo do navegador. */
  name: string;
  contentBase64: string;
};

export type BtgExtractFileFormat = 'pdf' | 'csv' | 'txt';

export type BtgExtractImportPreview = {
  kind: 'extract';
  path: string;
  fileName: string;
  format: BtgExtractFileFormat;
  lineCount: number;
  entryCount: number;
  openingBalance: number;
  firstDate: string | null;
  lastDate: string | null;
  lastExtractBalance: number | null;
  byOperation: Record<string, { count: number; total: number }>;
};

export type BtgBrokerageFileResult = {
  path: string;
  fileName: string;
  parseOk: boolean;
  notesCount: number;
  ledgerLines: number;
  parseError?: string;
  importOk?: boolean;
  importError?: string;
  inserted?: number;
  skipped?: number;
};

export type BtgBrokerageImportPreview = {
  kind: 'brokerage_notes';
  fileResults: BtgBrokerageFileResult[];
  filesTotal: number;
  filesOk: number;
  notesRaw: number;
  notesKept: number;
  ledgerLines: number;
};

export type BtgExtractFileResult = {
  path: string;
  fileName: string;
  format: BtgExtractFileFormat;
  parseOk: boolean;
  parseError?: string;
  preview?: BtgExtractImportPreview;
  month?: string | null;
  openingExtract?: number;
  closingExtract?: number | null;
  closingDate?: string | null;
  openingChainOk?: boolean | null;
  openingChainDelta?: number | null;
  openingLedgerOk?: boolean | null;
  openingLedgerBalance?: number | null;
  openingLedgerDelta?: number | null;
  closingLedgerOk?: boolean | null;
  closingLedgerBalance?: number | null;
  closingLedgerDelta?: number | null;
  monthAlreadyImported?: boolean;
  importBlocked?: boolean;
  importBlockReason?: string;
  importOk?: boolean;
  importError?: string;
  inserted?: number;
  skipped?: number;
  batchId?: string;
};

export type BtgExtractBatchPreview = {
  kind: 'extract_batch';
  fileResults: BtgExtractFileResult[];
  chainOk: boolean;
  filesTotal: number;
  filesOk: number;
};

export type BtgImportApplyResult = {
  batchId?: string;
  inserted: number;
  skipped: number;
  enriched: number;
  reconcile?: { positions: number };
};

function fileNameFromPath(path: string): string {
  const p = String(path || '').replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function decodeFile(input: BtgUploadFileInput): Buffer {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new GatewayError('INVALID_PAYLOAD', 'Nome do arquivo obrigatório.', 400);
  }
  const b64 = String(input.contentBase64 || '').trim();
  if (!b64) {
    throw new GatewayError('INVALID_PAYLOAD', `Arquivo vazio: ${name}`, 400);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    throw new GatewayError('INVALID_PAYLOAD', `Base64 inválido: ${name}`, 400);
  }
  if (buf.length > MAX_FILE_BYTES) {
    throw new GatewayError(
      'INVALID_PAYLOAD',
      `Arquivo muito grande (máx. ${MAX_FILE_BYTES / 1024 / 1024} MB): ${name}`,
      400
    );
  }
  if (buf.length < 4) {
    throw new GatewayError('INVALID_PAYLOAD', `Arquivo inválido: ${name}`, 400);
  }
  return buf;
}

function isExtractFileName(name: string): boolean {
  return /\.(pdf|csv|txt)$/i.test(fileNameFromPath(name));
}

function detectExtractFormat(name: string): BtgExtractFileFormat | null {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.txt$/i.test(name)) return 'txt';
  return null;
}

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(fileNameFromPath(name));
}

const BR_NUMBER = /(\d{1,3}(?:\.\d{3})*,\d{2}|-\d{1,3}(?:\.\d{3})*,\d{2})/;

function parseBrMoney(raw: string): number {
  const neg = raw.trim().startsWith('-');
  const n = Number(raw.replace(/^-/, '').replace(/\./g, '').replace(',', '.'));
  return neg ? -n : n;
}

function extractOpeningBalance(lines: string[]): number | null {
  for (const line of lines) {
    if (!/Saldo\s+Inicial/i.test(line)) continue;
    const m = line.match(BR_NUMBER);
    if (m) return parseBrMoney(m[1]!);
  }
  return null;
}

async function rawTextFromExtractUpload(file: BtgUploadFileInput): Promise<{
  raw: string;
  format: BtgExtractFileFormat;
}> {
  const path = file.name;
  const base = fileNameFromPath(path);
  const format = detectExtractFormat(base);
  if (!format) {
    throw new GatewayError(
      'INVALID_PAYLOAD',
      `Formato não suportado (${base}). Use PDF, CSV ou TXT.`,
      400
    );
  }
  const buf = decodeFile(file);
  if (format === 'pdf') {
    return { raw: await pdfBufferToText(buf), format };
  }
  return { raw: buf.toString('utf8'), format };
}

function normalizeExtractLines(raw: string, format: BtgExtractFileFormat): string[] {
  if (format === 'csv') {
    return btgExtractCsvToNormalizedLines(raw);
  }
  const normalized = raw.includes('Movimentação - Conta Corrente')
    ? normalizeBtgExtractPdfText(raw)
    : raw;
  return normalized.split(/\r?\n/).filter((l) => l.trim());
}

function assignExtractRefs(entries: LedgerImportLine[]): LedgerImportLine[] {
  const byDate = new Map<string, number>();
  return entries.map((e) => {
    const seq = (byDate.get(e.date) ?? 0) + 1;
    byDate.set(e.date, seq);
    return {
      ...e,
      operation: e.operation as LedgerTransactionType,
      broker_note_ref: `BTG-EXT-${e.date}#${String(seq).padStart(2, '0')}`,
    };
  });
}

function buildExtractPreview(
  file: BtgUploadFileInput,
  format: BtgExtractFileFormat,
  lines: string[]
): BtgExtractImportPreview {
  const openingBalance = extractOpeningBalance(lines) ?? DEFAULT_OPENING_BALANCE;
  const entries = btgLinesToImportEntries(lines, openingBalance);

  const byOperation: Record<string, { count: number; total: number }> = {};
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const e of entries) {
    byOperation[e.operation] = byOperation[e.operation] || { count: 0, total: 0 };
    byOperation[e.operation].count += 1;
    byOperation[e.operation].total += e.total_net_value;
    if (!firstDate || e.date < firstDate) firstDate = e.date;
    if (!lastDate || e.date > lastDate) lastDate = e.date;
  }

  const block = extractMovementBlock(lines.join('\n'));
  const series = parseExtractCashSeries(block, openingBalance);
  const last = lastExtractCashPoint(series);
  const closingDate = last?.date || lastDate;

  return {
    kind: 'extract',
    path: file.name,
    fileName: fileNameFromPath(file.name),
    format,
    lineCount: lines.length,
    entryCount: entries.length,
    openingBalance,
    firstDate,
    lastDate: closingDate,
    lastExtractBalance: last?.balance ?? null,
    byOperation,
  };
}

function resultFromParsed(
  parsed: ParsedExtractForBatch,
  ledgerEvents: LedgerEvent[] | null,
  previousClosing: number | null
): BtgExtractFileResult {
  const reconcile =
    ledgerEvents != null
      ? buildExtractReconcileFields(parsed, ledgerEvents, previousClosing)
      : null;
  return {
    path: parsed.path,
    fileName: parsed.fileName,
    format: parsed.preview.format,
    parseOk: true,
    preview: parsed.preview,
    ...(reconcile || {}),
  };
}

async function parseBtgExtractFile(
  file: BtgUploadFileInput
): Promise<BtgExtractFileResult | ParsedExtractForBatch> {
  const path = file.name;
  const fileName = fileNameFromPath(path);
  if (!isExtractFileName(fileName)) {
    return {
      path,
      fileName,
      format: detectExtractFormat(fileName) || 'txt',
      parseOk: false,
      parseError: 'Ignorado — use PDF, CSV ou TXT.',
    };
  }
  try {
    const { raw, format } = await rawTextFromExtractUpload(file);
    const lines = normalizeExtractLines(raw, format);
    const preview = buildExtractPreview(file, format, lines);
    return { path, fileName, preview };
  } catch (e) {
    return {
      path,
      fileName,
      format: detectExtractFormat(fileName) || 'txt',
      parseOk: false,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

function enrichBatchResults(
  parsedList: ParsedExtractForBatch[],
  ledgerEvents: LedgerEvent[]
): BtgExtractFileResult[] {
  const sorted = sortParsedExtracts(parsedList);
  const out: BtgExtractFileResult[] = [];
  let prevClosing: number | null = null;
  for (const parsed of sorted) {
    const row = resultFromParsed(parsed, ledgerEvents, prevClosing);
    out.push(row);
    if (row.closingExtract != null) prevClosing = row.closingExtract;
  }
  return out;
}

export async function previewBtgExtractBatchUpload(
  ctx: UserContext,
  ledger: LedgerImportService,
  files: BtgUploadFileInput[]
): Promise<BtgExtractBatchPreview> {
  if (!files?.length) {
    throw new GatewayError('INVALID_PAYLOAD', 'Envie ao menos um extrato (PDF/CSV/TXT).', 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  const ledgerEvents = await ledger.listLedgerEvents(ctx, '2000-01-01', today);

  const parsedList: ParsedExtractForBatch[] = [];
  const errors: BtgExtractFileResult[] = [];

  for (const file of files) {
    const parsed = await parseBtgExtractFile(file);
    if ('parseOk' in parsed) {
      errors.push(parsed);
    } else {
      parsedList.push(parsed);
    }
  }

  const okRows = enrichBatchResults(parsedList, ledgerEvents);
  const fileResults = [...okRows, ...errors].sort((a, b) => {
    const ma = a.month || a.preview?.firstDate?.slice(0, 7) || '';
    const mb = b.month || b.preview?.firstDate?.slice(0, 7) || '';
    return ma.localeCompare(mb) || a.path.localeCompare(b.path);
  });

  return {
    kind: 'extract_batch',
    fileResults,
    chainOk: batchChainIntact(fileResults),
    filesTotal: files.length,
    filesOk: okRows.length,
  };
}

export async function applyBtgExtractBatchUpload(
  ctx: UserContext,
  ledger: LedgerImportService,
  files: BtgUploadFileInput[]
): Promise<{
  fileResults: BtgExtractFileResult[];
  chainOk: boolean;
  totals: BtgImportApplyResult;
  const today = new Date().toISOString().slice(0, 10);
  let ledgerEvents = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const sorted = sortParsedExtracts(
    preview.fileResults
      .filter((r) => r.parseOk && r.preview)
      .map((r) => ({
        path: r.path,
        fileName: r.fileName,
        preview: r.preview!,
      }))
  );

  const fileResults: BtgExtractFileResult[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalEnriched = 0;
  let lastBatchId: string | undefined;
  let prevClosing: number | null = null;
  let hasInjectedAdjustments = false;

  for (const item of sorted) {
    const base = preview.fileResults.find((r) => r.path === item.path)!;
    const recon = buildExtractReconcileFields(item, ledgerEvents, prevClosing);

    let injectCashAdjustment = 0;
    if (recon.openingChainOk === false && recon.openingChainDelta != null && recon.openingChainDelta !== 0) {
      injectCashAdjustment = recon.openingChainDelta;
      hasInjectedAdjustments = true;
    }

    if (recon.monthAlreadyImported) {
      fileResults.push({
        ...base,
        ...recon,
        importOk: false,
        importError: `Mês ${recon.month} já possui lançamentos BTG-EXT no livro.`,
      });
      if (recon.closingExtract != null) prevClosing = recon.closingExtract;
      continue;
    }

    const applied = await applyBtgExtractUpload(ctx, ledger, {
      name: item.path,
      contentBase64: files.find((f) => f.name === item.path)!.contentBase64,
    }, { injectCashAdjustment });

    ledgerEvents = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const afterRecon = buildExtractReconcileFields(item, ledgerEvents, prevClosing);

    if (applied.importOk) {
      totalInserted += applied.inserted ?? 0;
      totalSkipped += applied.skipped ?? 0;
      lastBatchId = applied.batchId;
    }
    // enriched vem do importEntriesOnly interno; não exposto por arquivo

    fileResults.push({
      ...base,
      ...afterRecon,
      importOk: applied.importOk,
      importError: applied.importError,
      inserted: applied.inserted,
      skipped: applied.skipped,
      batchId: applied.batchId,
    });

    if (afterRecon.closingExtract != null) prevClosing = afterRecon.closingExtract;
  }

  const skippedPaths = new Set(fileResults.map((r) => r.path));
  for (const err of preview.fileResults.filter((r) => !r.parseOk)) {
    if (!skippedPaths.has(err.path)) fileResults.push(err);
  }

  fileResults.sort((a, b) => {
    const ma = a.month || '';
    const mb = b.month || '';
    return ma.localeCompare(mb) || a.path.localeCompare(b.path);
  });

  const reconcile = await ledger.reconcileCustody(ctx);

  return {
    fileResults,
    chainOk: batchChainIntact(fileResults),
    totals: {
      batchId: lastBatchId,
      inserted: totalInserted,
      skipped: totalSkipped,
      enriched: totalEnriched,
      reconcile: { positions: reconcile.positions },
    },
    blockedMessage: hasInjectedAdjustments 
      ? 'Atenção: Houve quebra na cadeia de saldos e ajustes automáticos foram injetados no livro de caixa para restabelecer a precisão matemática. Revise os itens em vermelho.'
      : undefined,
  };
}

export async function previewBtgExtractUpload(
  file: BtgUploadFileInput
): Promise<BtgExtractFileResult> {
  const parsed = await parseBtgExtractFile(file);
  if (!('parseOk' in parsed)) {
    return resultFromParsed(parsed, null, null);
  }
  return parsed;
}

/** Linhas do extrato prontas para import (mesma lógica do apply). */
export async function parseExtractUploadImportLines(
  file: BtgUploadFileInput,
  options?: import('./BtgExtractLineParser').BtgExtractParseOptions
): Promise<LedgerImportLine[]> {
  const { raw, format } = await rawTextFromExtractUpload(file);
  const lines = normalizeExtractLines(raw, format);
  const openingBalance = extractOpeningBalance(lines) ?? DEFAULT_OPENING_BALANCE;
  const rawEntries = btgLinesToImportEntries(lines, openingBalance, undefined, options);
  return assignExtractRefs(
    rawEntries.map((e) => ({
      ...e,
      operation: e.operation as LedgerTransactionType,
    }))
  );
}

export async function applyBtgExtractUpload(
  ctx: UserContext,
  ledger: LedgerImportService,
  file: BtgUploadFileInput,
  options?: { 
    parseOptions?: import('./BtgExtractLineParser').BtgExtractParseOptions;
    injectCashAdjustment?: number;
  }
): Promise<BtgExtractFileResult> {
  const previewResult = await previewBtgExtractUpload(file);
  if (!previewResult.parseOk || !previewResult.preview) {
    return {
      ...previewResult,
      importOk: false,
      importError: previewResult.parseError || 'Falha ao interpretar extrato.',
    };
  }

  try {
    const entries = await parseExtractUploadImportLines(file, options?.parseOptions);

    if (options?.injectCashAdjustment) {
      const adj = options.injectCashAdjustment;
      entries.unshift({
        date: entries[0]?.date || previewResult.preview.firstDate || new Date().toISOString().slice(0, 10),
        ticker: 'CAIXA-BTG',
        operation: adj > 0 ? 'cash_yield' : 'fee',
        quantity: 1,
        unit_price: Math.abs(adj),
        total_net_value: adj,
        notes: '⚠️ AJUSTE DE DIVERGÊNCIA BTG (Cadeia Quebrada)',
        source_system: 'invest.extract_adjustment'
      } as any);
    }

    const result = await ledger.importEntriesOnly(ctx, entries, {
      sourceLabel: `Extrato BTG upload ${previewResult.preview.firstDate ?? ''}->${previewResult.preview.lastDate ?? ''}`,
    });
    const reconcile = await ledger.reconcileCustody(ctx);

    return {
      ...previewResult,
      importOk: true,
      inserted: result.inserted,
      skipped: result.skipped,
      batchId: result.batchId,
      preview: previewResult.preview,
    };
  } catch (e) {
    return {
      ...previewResult,
      importOk: false,
      importError: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function previewBtgBrokerageUpload(
  files: BtgUploadFileInput[]
): Promise<BtgBrokerageImportPreview> {
  if (!files?.length) {
    throw new GatewayError('INVALID_PAYLOAD', 'Envie ao menos um arquivo PDF.', 400);
  }

  const fileResults: BtgBrokerageFileResult[] = [];
  const allNotes: BtgBrokerageNote[] = [];

  for (const file of files) {
    const path = file.name;
    const fileName = fileNameFromPath(path);
    if (!isPdfName(fileName)) {
      fileResults.push({
        path,
        fileName,
        parseOk: false,
        notesCount: 0,
        ledgerLines: 0,
        parseError: 'Ignorado — não é PDF.',
      });
      continue;
    }
    try {
      const buf = decodeFile(file);
      const lines = await pdfBufferToLines(buf);
      const notes = parseBtgBrokerageNoteBlocks(lines, path);
      allNotes.push(...notes);
      const { kept } = dedupeBrokerageNotes(notes);
      const ledgerLines = brokerageNotesToLedgerLines(kept).length;
      fileResults.push({
        path,
        fileName,
        parseOk: true,
        notesCount: kept.length,
        ledgerLines,
      });
    } catch (e) {
      fileResults.push({
        path,
        fileName,
        parseOk: false,
        notesCount: 0,
        ledgerLines: 0,
        parseError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const { kept: allKept } = dedupeBrokerageNotes(allNotes);

  return {
    kind: 'brokerage_notes',
    fileResults,
    filesTotal: files.length,
    filesOk: fileResults.filter((f) => f.parseOk).length,
    notesRaw: allNotes.length,
    notesKept: allKept.length,
    ledgerLines: brokerageNotesToLedgerLines(allKept).length,
  };
}

export async function applyBtgBrokerageUpload(
  ctx: UserContext,
  ledger: LedgerImportService,
  files: BtgUploadFileInput[],
  options?: { cashFromExtractOnly?: boolean }
): Promise<{
  fileResults: BtgBrokerageFileResult[];
  totals: BtgImportApplyResult;
  preview: BtgBrokerageImportPreview;
}> {
  const preview = await previewBtgBrokerageUpload(files);
  const fileResults: BtgBrokerageFileResult[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalEnriched = 0;
  let lastBatchId: string | undefined;

  for (const file of files) {
    const path = file.name;
    const fileName = fileNameFromPath(path);
    const basePreview = preview.fileResults.find((r) => r.path === path);

    if (!isPdfName(fileName)) {
      fileResults.push({
        ...(basePreview || { path, fileName, parseOk: false, notesCount: 0, ledgerLines: 0 }),
        importOk: false,
        importError: 'Ignorado — não é PDF.',
      });
      continue;
    }

    if (basePreview && !basePreview.parseOk) {
      fileResults.push({
        ...basePreview,
        importOk: false,
        importError: basePreview.parseError || 'Falha na leitura.',
      });
      continue;
    }

    try {
      const buf = decodeFile(file);
      const lines = await pdfBufferToLines(buf);
      const notes = parseBtgBrokerageNoteBlocks(lines, path);
      const { kept } = dedupeBrokerageNotes(notes);
      if (!kept.length) {
        fileResults.push({
          path,
          fileName,
          parseOk: true,
          notesCount: 0,
          ledgerLines: 0,
          importOk: false,
          importError: 'Nenhuma nota reconhecida neste PDF.',
        });
        continue;
      }
      let entries = brokerageNotesToLedgerLines(kept);
      if (options?.cashFromExtractOnly) {
        entries = suppressBrokerageNoteCashLines(entries);
      }
      const result = await ledger.importEntriesOnly(ctx, entries, {
        sourceLabel: `Nota BTG ${fileName}`,
      });
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalEnriched += result.enriched;
      lastBatchId = result.batchId;
      fileResults.push({
        path,
        fileName,
        parseOk: true,
        notesCount: kept.length,
        ledgerLines: entries.length,
        importOk: true,
        inserted: result.inserted,
        skipped: result.skipped,
      });
    } catch (e) {
      fileResults.push({
        path,
        fileName,
        parseOk: false,
        notesCount: 0,
        ledgerLines: 0,
        parseError: e instanceof Error ? e.message : String(e),
        importOk: false,
        importError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const reconcile = await ledger.reconcileCustody(ctx);

  return {
    fileResults,
    preview: { ...preview, fileResults },
    totals: {
      batchId: lastBatchId,
      inserted: totalInserted,
      skipped: totalSkipped,
      enriched: totalEnriched,
      reconcile: { positions: reconcile.positions },
    },
  };
}
