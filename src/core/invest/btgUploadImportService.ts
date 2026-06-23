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
import {
  brokerageNotesToLedgerLines,
  suppressBrokerageNoteCashLines,
} from './btgBrokerageNoteLedgerTranslator';
import { normalizeBtgExtractPdfText } from './btgExtractPdfText';
import { pdfBufferToLines, pdfBufferToText } from './btgPdfTextExtract';
import { LedgerImportService } from './LedgerImportService';
import { buildBtgExtractResolvers } from './buildBtgExtractResolvers';
import { parseLftInvestmentLotsFromText } from './lftInvestmentStatementLots';
import type { LedgerImportLine, LedgerTransactionType } from './ledgerTypes';
import { MAIN_CASH_TICKER } from './ledgerTypes';
import { parsePregaoDateFromLiqNotes } from './noteEventSettlement';
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
import { logReconcileEvent, logReconcileFailure } from './reconcile/reconcileErrorDetail';
import { InvestImportRulesRepository } from './InvestImportRulesRepository';
import { fingerprintFromImportLine } from './ledgerOperationDedup';

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
  simulatedLedgerLines?: LedgerImportLine[];
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
    if (!/Saldo\s+(Inicial|Anterior)/i.test(line)) continue;
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
  const normalized =
    format === 'pdf' || raw.includes('Movimentação - Conta Corrente')
      ? normalizeBtgExtractPdfText(raw)
      : raw;
  return normalized.split(/\r?\n/).filter((l) => l.trim());
}

function extractTesouroOperacoesContextLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  const start = lines.findIndex((l) =>
    /opera[cç][õo]es.*tesouro|tesouro\s+direto.*opera|renda\s+fixa.*opera/i.test(l) ||
    (/opera[cç][õo]es/i.test(l) && /LFT|COMPRA\s+DEFINITIVA|VENDA\s+DEFINITIVA/i.test(l))
  );
  if (start < 0) return [];
  const end = lines.findIndex(
    (l, i) =>
      i > start &&
      (/movimenta[cç][aã]o\s*-\s*conta\s*corrente/i.test(l) ||
        /^extrato de conta corrente$/i.test(l))
  );
  const slice = end > start ? lines.slice(start, end) : lines.slice(start, Math.min(start + 250, lines.length));
  return slice;
}

function extractParserContextLines(
  raw: string,
  format: BtgExtractFileFormat,
  normalizedLines: string[]
): string[] {
  if (format !== 'pdf') return normalizedLines;
  const tesouroOps = extractTesouroOperacoesContextLines(raw);
  // Movimentos CC ja estao em normalizedLines; rawLines duplicaria cada lancamento.
  if (tesouroOps.length) return [...tesouroOps, ...normalizedLines];
  return normalizedLines;
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
      source_system: 'btg_extract',
      counterparty: 'BTG Pactual',
      extract_category: e.extract_category,
    };
  });
}

function isLiqBolsaLine(line: LedgerImportLine): boolean {
  return /LIQ\s+BOLSA/i.test(String(line.notes || ''));
}

function signedCashValue(line: LedgerImportLine): number {
  return Math.round(Number(line.total_net_value ?? 0) * 100) / 100;
}

/** PDF/extrato pode repetir a mesma operacao patrimonial — dedup antes de refs sequenciais. */
export function dedupeExtractPatrimonyLines(lines: LedgerImportLine[]): LedgerImportLine[] {
  const seen = new Set<string>();
  const out: LedgerImportLine[] = [];
  for (const line of lines) {
    if (line.operation === 'pending_settlement') {
      out.push(line);
      continue;
    }
    const key = fingerprintFromImportLine(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** PDF pode duplicar LIQ BOLSA — mesma chave do parser de extrato. */
export function dedupeLiqBolsaImportLines(lines: LedgerImportLine[]): LedgerImportLine[] {
  const seen = new Set<string>();
  const out: LedgerImportLine[] = [];
  for (const line of lines) {
    if (!isLiqBolsaLine(line)) {
      out.push(line);
      continue;
    }
    const key = `${String(line.date).slice(0, 10)}|${Math.round(Number(line.total_net_value ?? 0) * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/**
 * Divergencia patrimonial quando o pool das notas nao fecha com o LIQ do extrato.
 * Caixa vem integralmente do LIQ; esta linha documenta o delta no PM gerencial.
 */
function liqNoteCashDivergenceLine(
  liqLine: LedgerImportLine,
  liqNet: number,
  poolSumCents: number
): LedgerImportLine | null {
  const delta = Math.round((liqNet - poolSumCents / 100) * 100) / 100;
  if (Math.abs(delta) < 0.01) return null;
  const ref = liqLine.broker_note_ref || `BTG-EXT-${liqLine.date}`;
  const poolNet = Math.round((poolSumCents / 100) * 100) / 100;
  return {
    date: liqLine.date,
    ticker: MAIN_CASH_TICKER,
    operation: 'extract_divergence',
    quantity: 0,
    unit_price: Math.abs(delta),
    total_net_value: Math.abs(delta),
    asset_type: 'cash',
    broker_note_ref: `${ref}#LIQ-NOTE-DIV`,
    event_source_ref: `BTG-LIQ-NOTE-DIV:${String(liqLine.date).slice(0, 10)}:${Math.round(Math.abs(delta) * 100)}`,
    notes:
      `Divergencia LIQ vs pool notas: liquido extrato ${liqNet.toFixed(2)} ` +
      `pool notas ${poolNet.toFixed(2)} delta ${delta.toFixed(2)}`,
    skip_financial_ledger: true,
    impacts_managerial_price: true,
  };
}

export function liqBolsaUnknownEventLine(
  liqLine: LedgerImportLine,
  reason: string
): LedgerImportLine {
  const net = signedCashValue(liqLine);
  const ref = liqLine.broker_note_ref || `BTG-EXT-${liqLine.date}`;
  const cents = Math.round(net * 100);
  return {
    ...liqLine,
    ticker: MAIN_CASH_TICKER,
    operation: 'extract_divergence',
    quantity: 1,
    unit_price: Math.abs(net),
    total_net_value: net,
    asset_type: 'cash',
    settlement_status: 'cleared',
    broker_note_ref: `${ref}#LIQ-UNKNOWN`,
    event_source_ref: `BTG-LIQ-UNKNOWN:${String(liqLine.date).slice(0, 10)}:${cents}`,
    source_system: 'btg_extract_unknown_liq_bolsa',
    extract_category: 3,
    notes:
      `${liqLine.notes || 'LIQ BOLSA'} | PENDENCIA_ANALISE: evento de negocio desconhecido; ` +
      `LIQ sem casamento com pending settlement. Motivo: ${reason}`,
  };
}
async function settleLiqBolsaEntries(
  ctx: UserContext,
  ledger: Pick<LedgerImportService, 'settleLiqBolsa'>,
  entries: LedgerImportLine[],
  options?: { keepUnmatchedAsCash?: boolean; keepUnmatchedAsUnknown?: boolean; skipUnmatched?: boolean }
): Promise<{
  entries: LedgerImportLine[];
  matched: number;
  keptAsCash: number;
  keptAsUnknown: number;
  skipped: number;
  unresolved: Array<{ date: string; net: number; notes: string | undefined; reason: string }>;
}> {
  let matched = 0;
  let keptAsCash = 0;
  let keptAsUnknown = 0;
  let skipped = 0;
  const unresolved: Array<{ date: string; net: number; notes: string | undefined; reason: string }> = [];
  const out: LedgerImportLine[] = [];

  for (const line of entries) {
    if (!isLiqBolsaLine(line)) {
      out.push(line);
      continue;
    }

    const net = signedCashValue(line);
    if (Math.abs(net) < 0.01) continue;
    const tradeDate = parsePregaoDateFromLiqNotes(line.notes) ?? undefined;
    const result = await ledger.settleLiqBolsa(ctx, {
      extractLineRef: line.broker_note_ref || `BTG-EXT-${line.date}`,
      settlementDate: line.date,
      valueSignedCents: Math.round(net * 100),
      tradeDate,
    });
    if (result.status === 'matched') {
      matched += result.settledEvents.length;
      continue;
    }
    if (
      !tradeDate &&
      /BTC|ALUGUEL|CORRETAGEM BTC/i.test(String(line.notes ?? ''))
    ) {
      keptAsCash += 1;
      out.push(line);
      continue;
    }
    if (options?.keepUnmatchedAsUnknown) {
      keptAsUnknown += 1;
      unresolved.push({
        date: line.date,
        net,
        notes: line.notes,
        reason: result.reason,
      });
      out.push(liqBolsaUnknownEventLine(line, result.reason));
      continue;
    }
    if (options?.keepUnmatchedAsCash) {
      keptAsCash += 1;
      out.push(line);
      if (result.status === 'blocked' && result.sumCents > 0) {
        const divLine = liqNoteCashDivergenceLine(line, net, result.sumCents);
        if (divLine) out.push(divLine);
      }
      continue;
    }
    if (options?.skipUnmatched) {
      skipped += 1;
      unresolved.push({
        date: line.date,
        net,
        notes: line.notes,
        reason: result.reason,
      });
      continue;
    }
    unresolved.push({
      date: line.date,
      net,
      notes: line.notes,
      reason: result.reason,
    });
  }

  return { entries: out, matched, keptAsCash, keptAsUnknown, skipped, unresolved };
}

function buildExtractPreview(
  file: BtgUploadFileInput,
  format: BtgExtractFileFormat,
  lines: string[],
  openingBalance: number,
  importRules?: import('./ledgerTypes').InvestImportRule[],
  parserContextLines = lines
): BtgExtractImportPreview {
  const entries = btgLinesToImportEntries(parserContextLines, openingBalance, undefined, { importRules });

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
  file: BtgUploadFileInput,
  resolvedOpeningBalance?: number | null
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
    const parserContextLines = extractParserContextLines(raw, format, lines);
    const openingBalance = extractOpeningBalance(lines) ?? resolvedOpeningBalance;
    if (openingBalance == null) {
      throw new GatewayError(
        'INVALID_PAYLOAD',
        'Saldo inicial nao encontrado no extrato nem no livro. Execute a migracao de abertura antes de importar ou envie extrato com Saldo Inicial.',
        400
      );
    }
    const preview = buildExtractPreview(file, format, lines, openingBalance, undefined, parserContextLines);
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
  const openingLedgerBalance = await ledger.getOpeningLedgerBalance(ctx);

  const parsedList: ParsedExtractForBatch[] = [];
  const errors: BtgExtractFileResult[] = [];

  for (const file of files) {
    const parsed = await parseBtgExtractFile(file, openingLedgerBalance);
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
  blockedMessage?: string;
}> {
  const startedAt = Date.now();
  logReconcileEvent('info', 'btg-extract.batch.start', ctx.organizationId ?? undefined, {
    files: files.length,
  });
  const preview = await previewBtgExtractBatchUpload(ctx, ledger, files);

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
  let hasBlockedChain = false;

  for (const item of sorted) {
    const base = preview.fileResults.find((r) => r.path === item.path)!;
    const recon = buildExtractReconcileFields(item, ledgerEvents, prevClosing);

    if (recon.openingChainOk === false) {
      hasBlockedChain = true;
      fileResults.push({
        ...base,
        ...recon,
        importOk: false,
        importError:
          `Cadeia de saldos quebrada no extrato ${item.fileName}: ` +
          `delta de abertura ${recon.openingChainDelta}. Corrija a origem antes de importar.`,
      });
      continue;
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
    });
    if (!applied.importOk) {
      logReconcileEvent('warn', 'btg-extract.file.error', ctx.organizationId ?? undefined, {
        fileName: item.fileName,
        month: base.month ?? base.preview?.firstDate?.slice(0, 7) ?? null,
        error: applied.importError ?? applied.parseError ?? 'unknown',
      });
    }

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
  const importErrors = fileResults.filter((r) => r.importOk === false).length;
  logReconcileEvent(importErrors ? 'warn' : 'info', 'btg-extract.batch.done', ctx.organizationId ?? undefined, {
    files: fileResults.length,
    importErrors,
    inserted: totalInserted,
    skipped: totalSkipped,
    chainOk: batchChainIntact(fileResults),
    durationMs: Date.now() - startedAt,
  });

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
    blockedMessage: hasBlockedChain
      ? 'Importacao bloqueada: houve quebra na cadeia de saldos. Corrija a origem antes de gravar novos movimentos.'
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

/**
 * Linhas normalizadas do extrato e saldo inicial — usadas pelo buildMonthReconcileLedger
 * para projetar o saldo via série de balanço em vez de entradas individuais classificadas.
 */
export async function getExtractNormalizedLines(file: BtgUploadFileInput): Promise<{
  normalizedLines: string[];
  openingBalance: number | null;
}> {
  const { raw, format } = await rawTextFromExtractUpload(file);
  const lines = normalizeExtractLines(raw, format);
  return { normalizedLines: lines, openingBalance: extractOpeningBalance(lines) };
}

/** Linhas do extrato prontas para import (mesma lógica do apply). */
export async function parseExtractUploadImportLines(
  file: BtgUploadFileInput,
  options?: import('./BtgExtractLineParser').BtgExtractParseOptions,
  resolvedOpeningBalance?: number,
  importRulesRepo?: InvestImportRulesRepository,
  ctx?: UserContext,
  ledger?: LedgerImportService
): Promise<LedgerImportLine[]> {
  const { raw, format } = await rawTextFromExtractUpload(file);
  const lines = normalizeExtractLines(raw, format);
  const parserContextLines = extractParserContextLines(raw, format, lines);
  const openingBalance = extractOpeningBalance(lines) ?? resolvedOpeningBalance;
  if (openingBalance == null) {
    throw new GatewayError(
      'INVALID_PAYLOAD',
      'Saldo inicial nao encontrado no extrato nem no livro. Execute POST /invest/reconcile/migrate-opening-balance primeiro.',
      400
    );
  }
  const importRules =
    importRulesRepo && ctx ? await importRulesRepo.loadForBroker(ctx, 'BTG') : [];
  // Lotes LFT vem do arquivo enviado (extrato de investimento) ou de lotes
  // passados pelo orquestrador do lote; nunca de leitura de disco/cache global.
  const lftInvestmentLots = options?.lftInvestmentLots?.length
    ? options.lftInvestmentLots
    : parseLftInvestmentLotsFromText(raw);
  const mergedOptions = {
    ...options,
    importRules,
    ...(lftInvestmentLots.length ? { lftInvestmentLots } : {}),
  };
  let resolvers: import('./BtgExtractLineParser').BtgExtractResolvers | undefined;
  if (ledger && ctx?.organizationId && typeof ledger.listLedgerEvents === 'function') {
    const today = new Date().toISOString().slice(0, 10);
    const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
    resolvers = buildBtgExtractResolvers(events);
  }
  const rawEntries = btgLinesToImportEntries(
    parserContextLines,
    openingBalance,
    resolvers,
    mergedOptions
  );
  return assignExtractRefs(
    dedupeLiqBolsaImportLines(
      dedupeExtractPatrimonyLines(
        rawEntries.map((e) => ({
          ...e,
          operation: e.operation as LedgerTransactionType,
        }))
      )
    )
  );
}

export async function applyBtgExtractUpload(
  ctx: UserContext,
  ledger: LedgerImportService,
  file: BtgUploadFileInput,
  options?: { 
    parseOptions?: import('./BtgExtractLineParser').BtgExtractParseOptions;
    keepUnmatchedLiqBolsaAsCash?: boolean;
    /** LIQ sem casamento: grava caixa como evento desconhecido pendente de analise. */
    keepUnmatchedLiqBolsaAsUnknown?: boolean;
    /** LIQ sem casamento: nao grava caixa orfao; importa demais linhas. */
    skipUnmatchedLiqBolsa?: boolean;
    /** Deprecated: nao usar em fluxos novos; cadeia quebrada deve bloquear. */
    injectCashAdjustment?: number;
  }
): Promise<BtgExtractFileResult> {
  const path = file.name;
  const fileName = fileNameFromPath(path);
  if (!isExtractFileName(fileName)) {
    return {
      path,
      fileName,
      format: detectExtractFormat(fileName) || 'txt',
      parseOk: false,
      importOk: false,
      parseError: 'Ignorado — use PDF, CSV ou TXT.',
      importError: 'Ignorado — use PDF, CSV ou TXT.',
    };
  }

  let previewResult: BtgExtractFileResult | null = null;
  try {
    const { raw, format } = await rawTextFromExtractUpload(file);
    const lines = normalizeExtractLines(raw, format);
    const parserContextLines = extractParserContextLines(raw, format, lines);
    const openingBalance = extractOpeningBalance(lines) ?? (await ledger.getOpeningLedgerBalance(ctx));
    if (openingBalance == null) {
      throw new GatewayError(
        'INVALID_PAYLOAD',
        'Saldo inicial nao encontrado no extrato nem no livro. Execute POST /invest/reconcile/migrate-opening-balance primeiro.',
        400
      );
    }
    const preview = buildExtractPreview(file, format, lines, openingBalance, undefined, parserContextLines);
    previewResult = resultFromParsed({ path, fileName, preview }, null, null);

    await ledger.reconcileCustody(ctx);
    const parseOptions = { includeLiqBolsa: true, ...(options?.parseOptions ?? {}) };
    let entries = await parseExtractUploadImportLines(
      file,
      parseOptions,
      openingBalance,
      undefined,
      ctx,
      ledger
    );
    const keepUnmatchedAsCash = options?.keepUnmatchedLiqBolsaAsCash === true;
    const skipUnmatched = options?.skipUnmatchedLiqBolsa === true;
    const liqBolsaSettlement = await settleLiqBolsaEntries(ctx, ledger, entries, {
      keepUnmatchedAsCash,
      /**
       * Default true (LIQ sem casamento vira evento desconhecido investigavel),
       * exceto quando o chamador pediu explicitamente manter como caixa ou pular.
       */
      keepUnmatchedAsUnknown:
        options?.keepUnmatchedLiqBolsaAsUnknown != null
          ? options.keepUnmatchedLiqBolsaAsUnknown
          : !keepUnmatchedAsCash && !skipUnmatched,
      skipUnmatched,
    });
    entries = liqBolsaSettlement.entries;
    if (liqBolsaSettlement.matched || liqBolsaSettlement.keptAsCash || liqBolsaSettlement.keptAsUnknown || liqBolsaSettlement.skipped || liqBolsaSettlement.unresolved.length) {
      logReconcileEvent(
        liqBolsaSettlement.unresolved.length ? 'warn' : 'info',
        'btg-extract.liq-bolsa.business-events',
        ctx.organizationId ?? undefined,
        {
          fileName: previewResult.fileName,
          matched: liqBolsaSettlement.matched,
          keptAsCash: liqBolsaSettlement.keptAsCash,
          keptAsUnknown: liqBolsaSettlement.keptAsUnknown,
          skipped: liqBolsaSettlement.skipped,
          unresolved: liqBolsaSettlement.unresolved.length,
        }
      );
    }

    if (
      liqBolsaSettlement.unresolved.length &&
      options?.skipUnmatchedLiqBolsa !== true &&
      options?.keepUnmatchedLiqBolsaAsUnknown !== true
    ) {
      const details = liqBolsaSettlement.unresolved
        .slice(0, 5)
        .map((u) => `${u.date}: ${u.net} (${u.reason})`)
        .join('; ');
      return {
        ...previewResult,
        importOk: false,
        importError:
          `LIQ BOLSA sem casamento com eventos de negocio (${liqBolsaSettlement.unresolved.length}). ` +
          `Corrija notas/eventos pendentes antes de importar. ${details}`,
      };
    }

    if (options?.injectCashAdjustment) {
      return {
        ...previewResult,
        importOk: false,
        importError:
          'Importacao bloqueada: ajuste automatico de divergencia foi desativado. Corrija a origem antes de gravar.',
      };
    }

    const result = await ledger.importEntriesOnly(ctx, entries, {
      sourceLabel: `Extrato BTG upload ${preview.firstDate ?? ''}->${preview.lastDate ?? ''}`,
    });
    const reconcile = await ledger.reconcileCustody(ctx);

    return {
      ...previewResult,
      importOk: true,
      inserted: result.inserted,
      skipped: result.skipped,
      batchId: result.batchId,
      preview,
    };
  } catch (e) {
    const importError = e instanceof Error ? e.message : String(e);
    if (!previewResult?.preview) {
      logReconcileFailure('btg-extract.file.apply', ctx.organizationId ?? undefined, e, {
        fileName,
      });
      return {
        path,
        fileName,
        format: detectExtractFormat(fileName) || 'txt',
        parseOk: false,
        parseError: importError,
        importOk: false,
        importError,
      };
    }
    logReconcileFailure('btg-extract.file.apply', ctx.organizationId ?? undefined, e, {
      fileName: previewResult.fileName,
      firstDate: previewResult.preview.firstDate,
      lastDate: previewResult.preview.lastDate,
      entryCount: previewResult.preview.entryCount,
    });
    return {
      ...previewResult,
      importOk: false,
      importError,
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
      const ledgerLines = suppressBrokerageNoteCashLines(brokerageNotesToLedgerLines(kept)).length;
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
  const finalLedgerLines = suppressBrokerageNoteCashLines(brokerageNotesToLedgerLines(allKept));

  return {
    kind: 'brokerage_notes',
    fileResults,
    filesTotal: files.length,
    filesOk: fileResults.filter((f) => f.parseOk).length,
    notesRaw: allNotes.length,
    notesKept: allKept.length,
    ledgerLines: finalLedgerLines.length,
    simulatedLedgerLines: finalLedgerLines,
  };
}

export async function applyBtgBrokerageUpload(
  ctx: UserContext,
  ledger: LedgerImportService,
  files: BtgUploadFileInput[]
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
      const entries = suppressBrokerageNoteCashLines(brokerageNotesToLedgerLines(kept));
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
