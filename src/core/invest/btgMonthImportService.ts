/**
 * Importação mensal unificada: extrato + notas do mesmo YYYY-MM, com batimento conjunto.
 */
import type { UserContext } from '../dal';
import { GatewayError } from '../dal';
import type { LedgerEvent } from './CustodyEngine';
import { settledCashBalanceFromLedger } from './cashInvestLedger';
import {
  buildExtractReconcileFields,
  inferExtractMonth,
  isExtractMonthInLedger,
  MONTH_IMPORT_CASH_TOLERANCE,
  type ParsedExtractForBatch,
} from './btgExtractBatchReconcile';
import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
} from './btgBrokerageNoteParser';
import { brokerageNotesToLedgerLines } from './btgBrokerageNoteLedgerTranslator';
import { pdfBufferToLines } from './btgPdfTextExtract';
import type { LedgerImportLine, LedgerTransactionType } from './ledgerTypes';
import { MAIN_CASH_TICKER } from './ledgerTypes';
import { LedgerImportService } from './LedgerImportService';
import { importLineExpectedCashNet } from './cashExtractDedup';
import {
  applyBtgBrokerageUpload,
  applyBtgExtractUpload,
  type BtgBrokerageImportPreview,
  type BtgExtractFileResult,
  type BtgUploadFileInput,
  parseExtractUploadImportLines,
  previewBtgBrokerageUpload,
  previewBtgExtractUpload,
} from './btgUploadImportService';

const CASH_OPS = new Set<LedgerTransactionType>([
  'buy',
  'sell',
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'option_exercise',
]);

export type BtgMonthImportPreview = {
  kind: 'month_import';
  month: string;
  notesOk: boolean;
  financialOk: boolean;
  resultOk: boolean;
  notesDetail: string;
  financialDetail: string;
  resultDetail: string;
  notesFilesInFolder: number;
  notesFilesInMonth: number;
  notes: BtgBrokerageImportPreview;
  extract: BtgExtractFileResult;
};

export type BtgMonthImportApplyResult = BtgMonthImportPreview & {
  applied: boolean;
  notesInserted: number;
  notesSkipped: number;
  extractInserted: number;
  extractSkipped: number;
};

/** Filtra arquivos cuja pasta/nome pertence ao mês YYYY-MM. */
export function filterFilesForMonth(files: BtgUploadFileInput[], month: string): BtgUploadFileInput[] {
  const [y, m] = month.split('-');
  if (!y || !m) return [];
  const needles = [
    `${y}-${m}`,
    `${y}_${m}`,
    `${y}${m}`,
    `/${m}/`,
    `\\${m}\\`,
    `-${m}-`,
    `_${m}_`,
  ].map((s) => s.toLowerCase());

  const monthNames = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  const mi = Number(m) - 1;
  const monLabel = monthNames[mi];
  if (monLabel) {
    needles.push(`${monLabel}_${y}`, `${monLabel}-${y}`, `${monLabel}${y}`);
  }

  return files.filter((f) => {
    const p = String(f.name || '').replace(/\\/g, '/').toLowerCase();
    if (/_summary\.pdf$/i.test(p)) return false;
    return needles.some((n) => p.includes(n.replace(/\\/g, '/')));
  });
}

function isPdfPath(name: string): boolean {
  return /\.pdf$/i.test(name.split(/[/\\]/).pop() || '');
}

function projectedCashFromExtractLines(lines: LedgerImportLine[]): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of lines) {
    const net = importLineExpectedCashNet(line);
    if (net == null || Math.abs(net) < 0.005) continue;
    const d = String(line.date || '').slice(0, 10);
    if (!d) continue;
    out.push({
      asset_id: `proj-ext-${line.broker_note_ref || d}`,
      asset_ticker: MAIN_CASH_TICKER,
      asset_type: 'cash',
      transaction_type: line.operation as LedgerTransactionType,
      transaction_date: d,
      quantity: 1,
      unit_price: net,
      total_net_value: net,
      broker_note_ref: line.broker_note_ref ? `${line.broker_note_ref}:CASH` : null,
    });
  }
  return out;
}

function projectedCashFromNoteLines(lines: LedgerImportLine[]): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of lines) {
    const op = line.operation as LedgerTransactionType;
    if (!CASH_OPS.has(op)) continue;
    const net = Number(line.total_net_value ?? 0);
    if (Math.abs(net) < 0.005) continue;
    const d = String(line.settlement_date || line.date || '').slice(0, 10);
    if (!d) continue;
    out.push({
      asset_id: `proj-${line.broker_note_ref || d}`,
      asset_ticker: MAIN_CASH_TICKER,
      asset_type: 'cash',
      transaction_type: op,
      transaction_date: d,
      quantity: 1,
      unit_price: net,
      total_net_value: net,
      broker_note_ref: line.broker_note_ref ? `${line.broker_note_ref}:CASH` : null,
    });
  }
  return out;
}

async function buildProjectedLedger(
  ctx: UserContext,
  ledger: LedgerImportService,
  noteFiles: BtgUploadFileInput[],
  extractFile?: BtgUploadFileInput
): Promise<LedgerEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const base = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const allNotes = [];
  for (const file of noteFiles) {
    if (!isPdfPath(file.name)) continue;
    try {
      const buf = Buffer.from(String(file.contentBase64 || ''), 'base64');
      const lines = await pdfBufferToLines(buf);
      allNotes.push(...parseBtgBrokerageNoteBlocks(lines, file.name));
    } catch {
      /* preview ignora PDF inválido; notesOk ficará false */
    }
  }
  const { kept } = dedupeBrokerageNotes(allNotes);
  const importLines = brokerageNotesToLedgerLines(kept);
  let projected = [...base, ...projectedCashFromNoteLines(importLines)];
  if (extractFile?.contentBase64) {
    try {
      const extractLines = await parseExtractUploadImportLines(extractFile);
      projected = [...projected, ...projectedCashFromExtractLines(extractLines)];
    } catch {
      /* preview de extrato falha em parse; financialOk refletirá */
    }
  }
  return projected;
}

function evaluateMonthPreview(
  month: string,
  notesPreview: BtgBrokerageImportPreview,
  extract: BtgExtractFileResult,
  notesFilesInFolder: number,
  notesFilesInMonth: number
): Pick<
  BtgMonthImportPreview,
  'notesOk' | 'financialOk' | 'resultOk' | 'notesDetail' | 'financialDetail' | 'resultDetail'
> {
  const notesOk =
    notesFilesInMonth > 0 &&
    notesPreview.filesOk === notesPreview.filesTotal &&
    notesPreview.filesTotal > 0 &&
    notesPreview.notesKept > 0;

  const notesDetail = !notesFilesInMonth
    ? 'Nenhum PDF de nota encontrado para este mês na pasta.'
    : !notesOk
      ? `${notesPreview.filesOk}/${notesPreview.filesTotal} arquivo(s) OK · ${notesPreview.notesKept} nota(s) · ${notesPreview.ledgerLines} lanç.`
      : `${notesPreview.notesKept} nota(s) · ${notesPreview.ledgerLines} lanç. no livro`;

  const extractMonth =
    extract.preview
      ? inferExtractMonth(
          extract.fileName,
          extract.preview.firstDate,
          extract.preview.lastDate
        )
      : inferExtractMonth(extract.fileName, null, null);

  const monthMatch = !extractMonth || extractMonth === month;

  const financialOk =
    Boolean(extract.parseOk) &&
    monthMatch &&
    extract.openingLedgerOk === true &&
    extract.closingLedgerOk === true &&
    !extract.monthAlreadyImported;

  const financialParts: string[] = [];
  if (!extract.parseOk) financialParts.push(extract.parseError || 'extrato ilegível');
  if (extractMonth && extractMonth !== month) {
    financialParts.push(`extrato parece ser ${extractMonth}, não ${month}`);
  }
  if (extract.monthAlreadyImported) financialParts.push('extrato deste mês já importado');
  if (extract.openingLedgerOk === false) {
    financialParts.push(`ini. Δ R$ ${extract.openingLedgerDelta?.toFixed(2) ?? '?'}`);
  }
  if (extract.closingLedgerOk === false) {
    financialParts.push(`fim. Δ R$ ${extract.closingLedgerDelta?.toFixed(2) ?? '?'}`);
  }
  if (financialOk && extract.preview) {
    financialParts.push(
      `saldo fim extrato R$ ${extract.closingExtract?.toFixed(2)} · ${extract.preview.entryCount} mov.`
    );
  }
  const financialDetail =
    financialParts.join(' · ') || (extract.parseOk ? 'extrato coerente com o livro (+ notas simuladas)' : '—');

  const resultOk = notesOk && financialOk;

  let resultDetail = '';
  if (resultOk) {
    resultDetail = 'Mês pronto para importar: notas e extrato coerentes com o livro (simulação pós-notas).';
  } else if (notesOk && extract.parseOk && extract.closingLedgerOk === false) {
    resultDetail =
      'Notas OK, mas caixa do extrato não fecha com o livro após simular as notas. Pode haver LIQ BOLSA duplicada ao importar o extrato — revise antes de gravar.';
  } else if (!notesOk && financialOk) {
    resultDetail = 'Corrija as notas antes de fechar o mês.';
  } else {
    resultDetail = 'Ajuste notas e/ou extrato até as três colunas ficarem OK.';
  }

  return { notesOk, financialOk, resultOk, notesDetail, financialDetail, resultDetail };
}

export async function previewBtgMonthImport(
  ctx: UserContext,
  ledger: LedgerImportService,
  month: string,
  extractFile: BtgUploadFileInput,
  noteFilesAll: BtgUploadFileInput[]
): Promise<BtgMonthImportPreview> {
  const monthNorm = String(month || '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthNorm)) {
    throw new GatewayError('INVALID_PAYLOAD', 'Informe o mês no formato YYYY-MM.', 400);
  }
  if (!extractFile?.name || !extractFile?.contentBase64) {
    throw new GatewayError('INVALID_PAYLOAD', 'Envie o extrato do mês (PDF ou CSV).', 400);
  }

  const noteFiles = filterFilesForMonth(
    noteFilesAll.filter((f) => isPdfPath(f.name)),
    monthNorm
  );

  const notes = await previewBtgBrokerageUpload(noteFiles);
  const today = new Date().toISOString().slice(0, 10);
  const baseLedger = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const projectedLedger = await buildProjectedLedger(ctx, ledger, noteFiles, extractFile);

  const parsedExtract = await previewBtgExtractUpload(extractFile);
  let extract: BtgExtractFileResult = parsedExtract;

  if (parsedExtract.parseOk && parsedExtract.preview) {
    const parsed: ParsedExtractForBatch = {
      path: parsedExtract.path,
      fileName: parsedExtract.fileName,
      preview: parsedExtract.preview,
    };
    const recon = buildExtractReconcileFields(parsed, projectedLedger, null, {
      tolerance: MONTH_IMPORT_CASH_TOLERANCE,
    });
    extract = {
      ...parsedExtract,
      ...recon,
      monthAlreadyImported: isExtractMonthInLedger(baseLedger, monthNorm),
    };
  }

  const flags = evaluateMonthPreview(
    monthNorm,
    notes,
    extract,
    noteFilesAll.filter((f) => isPdfPath(f.name)).length,
    noteFiles.length
  );

  return {
    kind: 'month_import',
    month: monthNorm,
    ...flags,
    notesFilesInFolder: noteFilesAll.filter((f) => isPdfPath(f.name)).length,
    notesFilesInMonth: noteFiles.length,
    notes,
    extract,
  };
}

export async function applyBtgMonthImport(
  ctx: UserContext,
  ledger: LedgerImportService,
  month: string,
  extractFile: BtgUploadFileInput,
  noteFilesAll: BtgUploadFileInput[]
): Promise<BtgMonthImportApplyResult> {
  const preview = await previewBtgMonthImport(ctx, ledger, month, extractFile, noteFilesAll);

  if (!preview.notesOk || !preview.extract.parseOk) {
    return {
      ...preview,
      applied: false,
      notesInserted: 0,
      notesSkipped: 0,
      extractInserted: 0,
      extractSkipped: 0,
      resultDetail:
        preview.resultDetail || 'Corrija notas e extrato antes de gravar este mês.',
    };
  }

  if (preview.extract.monthAlreadyImported) {
    return {
      ...preview,
      applied: false,
      notesInserted: 0,
      notesSkipped: 0,
      extractInserted: 0,
      extractSkipped: 0,
      resultDetail:
        'Extrato deste mês já consta no livro (BTG-EXT). Apague o mês antes de reimportar.',
    };
  }

  if (!preview.financialOk) {
    return {
      ...preview,
      applied: false,
      notesInserted: 0,
      notesSkipped: 0,
      extractInserted: 0,
      extractSkipped: 0,
      resultDetail:
        preview.financialDetail ||
        'Batimento financeiro não OK — ajuste abertura ou extrato antes de gravar.',
    };
  }

  const noteFiles = filterFilesForMonth(
    noteFilesAll.filter((f) => isPdfPath(f.name)),
    preview.month
  );

  const notesApply = await applyBtgBrokerageUpload(ctx, ledger, noteFiles);
  const extractApply = await applyBtgExtractUpload(ctx, ledger, extractFile);

  const notesInserted = notesApply.totals.inserted;
  const notesSkipped = notesApply.totals.skipped;
  const extractInserted = extractApply.inserted ?? 0;
  const extractSkipped = extractApply.skipped ?? 0;

  const afterPreview = await previewBtgMonthImport(ctx, ledger, month, extractFile, noteFilesAll);
  const applied = Boolean(extractApply.importOk);

  return {
    ...afterPreview,
    applied,
    notesInserted,
    notesSkipped,
    extractInserted,
    extractSkipped,
    financialOk: applied ? preview.financialOk : afterPreview.financialOk,
    resultOk: applied && preview.resultOk,
    resultDetail: applied
      ? `Importado: notas +${notesInserted}/-${notesSkipped}, extrato +${extractInserted}/-${extractSkipped}.`
      : extractApply.importError || 'Falha ao gravar extrato.',
  };
}
