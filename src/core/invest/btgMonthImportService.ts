/**
 * Importação mensal unificada: extrato + notas do mesmo YYYY-MM, com batimento conjunto.
 */
import type { UserContext } from '../dal';
import { GatewayError } from '../dal';
import pool from '../../config/database';
import { ensureExtractDivergenceOperation } from '../db/ensureCoreSchema';
import type { LedgerEvent } from './CustodyEngine';
import { isCashInvestTicker } from './cashInvestLedger';
import {
  buildExtractReconcileFields,
  inferExtractMonth,
  isExtractMonthInLedger,
  MONTH_IMPORT_CASH_TOLERANCE,
  sortParsedExtracts,
  type ParsedExtractForBatch,
} from './btgExtractBatchReconcile';
import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
} from './btgBrokerageNoteParser';
import { brokerageNotesToLedgerLines, suppressBrokerageNoteCashLines, BROKERAGE_NOTE_CASH_OPS } from './btgBrokerageNoteLedgerTranslator';
import { mapBrokerOrderToLedger } from './brokerOrderMapper';
import { cashSettlementDate } from './settlementCalendar';
import { pdfBufferToLines } from './btgPdfTextExtract';
import type { LedgerTransactionType } from './ledgerTypes';
import { MAIN_CASH_TICKER } from './ledgerTypes';
import { LedgerImportService } from './LedgerImportService';
import type { BtgExtractParseOptions } from './BtgExtractLineParser';
import { extractMovementBlock, parseExtractCashSeries } from './btgExtractCashSeries';
import {
  applyBtgBrokerageUpload,
  applyBtgExtractUpload,
  type BtgBrokerageImportPreview,
  type BtgExtractFileResult,
  type BtgUploadFileInput,
  getExtractNormalizedLines,
  parseExtractUploadImportLines,
  previewBtgBrokerageUpload,
  previewBtgExtractUpload,
} from './btgUploadImportService';
import {
  consumeSignedCentsSubset,
  liqBolsaBlockReason,
} from './LiqBolsaSettlementService';
import type { LedgerImportLine } from './ledgerTypes';
import { logInvestStdout } from './reconcile/reconcileErrorDetail';

function logMonthImportStdout(
  orgId: string | null | undefined,
  tag: string,
  month: string,
  preview: BtgMonthImportPreview,
  detail?: string
): void {
  const e = preview.extract;
  logInvestStdout(
    'btg-import',
    orgId,
    `${tag} month=${month} notesOk=${preview.notesOk} finOk=${preview.financialOk} resultOk=${preview.resultOk} ` +
      `pdfs=${preview.notesFilesInMonth}/${preview.notesFilesInFolder} ` +
      `openingExt=${e.openingExtract ?? '?'} closingExt=${e.closingExtract ?? '?'} ` +
      `openingLedgerOk=${e.openingLedgerOk ?? '?'} closingLedgerOk=${e.closingLedgerOk ?? '?'} ` +
      `liqBolsaOk=${preview.liqBolsaOk ?? '?'} ` +
      `detail=${detail ?? preview.resultDetail}`
  );
}

/**
 * Notas = patrimônio (skip_financial_ledger=true); caixa vem exclusivamente do extrato.
 * LIQ BOLSA deve ser incluída na simulação: ela representa liquidações D+2 do mês anterior
 * que se liquidam no início do mês corrente — sem ela o saldo inicial não bate com o extrato.
 */
const MONTH_IMPORT_EXTRACT_OPTS_APPLY: BtgExtractParseOptions = { includeLiqBolsa: true };

export type BtgMonthImportPreview = {
  kind: 'month_import';
  month: string;
  notesOk: boolean;
  financialOk: boolean;
  resultOk: boolean;
  notesDetail: string;
  financialDetail: string;
  resultDetail: string;
  /** Previa estrita: casamento LIQ BOLSA x expectativas pending das notas. */
  liqBolsaOk?: boolean;
  liqBolsaDetail?: string;
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

export type MonthExtractPlanEntry = {
  month: string;
  extractFile: BtgUploadFileInput;
};

/** Intervalo calendário [from, to] de um mês YYYY-MM. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) {
    return null;
  }
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Ordena extratos por mês e retorna um par mês→arquivo (último arquivo vence duplicatas). */
export async function discoverMonthExtractPlan(
  extractFiles: BtgUploadFileInput[]
): Promise<MonthExtractPlanEntry[]> {
  const parsed: ParsedExtractForBatch[] = [];
  for (const file of extractFiles) {
    const preview = await previewBtgExtractUpload(file);
    if (!preview.parseOk || !preview.preview) continue;
    parsed.push({
      path: preview.path,
      fileName: preview.fileName,
      preview: preview.preview,
    });
  }

  const sorted = sortParsedExtracts(parsed);
  const byMonth = new Map<string, BtgUploadFileInput>();
  for (const item of sorted) {
    const month =
      inferExtractMonth(item.fileName, item.preview.firstDate, item.preview.lastDate) ??
      item.preview.firstDate?.slice(0, 7);
    if (!month) continue;
    const file = extractFiles.find((f) => f.name === item.path);
    if (file) byMonth.set(month, file);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, extractFile]) => ({ month, extractFile }));
}

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
  const monthNamesFull = [
    'janeiro',
    'fevereiro',
    'marco',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  const mi = Number(m) - 1;
  const monLabel = monthNames[mi];
  if (monLabel) {
    needles.push(`${monLabel}_${y}`, `${monLabel}-${y}`, `${monLabel}${y}`, `/${monLabel}/`);
  }
  const monFull = monthNamesFull[mi];
  if (monFull) {
    needles.push(`/${monFull}/`, `\\${monFull}\\`, `${monFull}_${y}`, `${monFull}-${y}`);
  }

  return files.filter((f) => {
    const p = String(f.name || '').replace(/\\/g, '/').toLowerCase();
    if (/_summary\.pdf$/i.test(p)) return false;
    return needles.some((n) => p.includes(n.replace(/\\/g, '/')));
  });
}

function decodeUploadBase64(file: BtgUploadFileInput): Buffer {
  return Buffer.from(file.contentBase64, 'base64');
}

/** Nota entra no mês se o pregão OU alguma liquidação D+N cair no YYYY-MM. */
export function noteAffectsMonth(note: BtgBrokerageNote, monthNorm: string): boolean {
  if (String(note.pregaoDate || '').slice(0, 7) === monthNorm) return true;
  for (const trade of note.trades) {
    if (note.category === 'LOAN') {
      const ticker = (trade.underlyingStock || trade.ticker || '').toUpperCase();
      const settle = cashSettlementDate(
        note.pregaoDate,
        'securities_lending',
        'securities_lending',
        ticker
      );
      if (settle.slice(0, 7) === monthNorm) return true;
      continue;
    }
    const mapped = mapBrokerOrderToLedger({
      ticker: trade.ticker,
      direction: trade.side,
      quantity: Math.abs(Number(trade.quantity) || 0),
      avgPrice: Number(trade.unitPrice) || 0,
      date: note.pregaoDate,
      broker_note_ref: 'preview',
    });
    for (const line of mapped) {
      const settle = cashSettlementDate(
        note.pregaoDate,
        line.asset_type || 'stock',
        line.operation,
        line.ticker
      );
      if (settle.slice(0, 7) === monthNorm) return true;
    }
  }
  return false;
}

/**
 * Notas do mês: primeiro por pasta/nome; depois por data de pregão dentro do PDF (padrão B3).
 */
export async function resolveNoteFilesForMonth(
  files: BtgUploadFileInput[],
  month: string
): Promise<BtgUploadFileInput[]> {
  const monthNorm = month.slice(0, 7);
  const pdfs = files.filter((f) => isPdfPath(f.name));
  const byPath = filterFilesForMonth(pdfs, monthNorm);
  const seen = new Set(byPath.map((f) => f.name));
  const out = [...byPath];

  for (const file of pdfs) {
    if (seen.has(file.name)) continue;
    try {
      const lines = await pdfBufferToLines(decodeUploadBase64(file));
      const notes = parseBtgBrokerageNoteBlocks(lines, file.name);
      const inMonth = notes.some((n) => noteAffectsMonth(n, monthNorm));
      if (inMonth) {
        out.push(file);
        seen.add(file.name);
      }
    } catch {
      /* PDF ilegível — ignorado */
    }
  }
  return out;
}

function isPdfPath(name: string): boolean {
  return /\.pdf$/i.test(name.split(/[/\\]/).pop() || '');
}

/** Caixa do mês que seria recriado por notas + extrato (não inclui abertura 01/01). */
export function isMonthBtgImportCashEvent(event: LedgerEvent, month: string): boolean {
  const ym = String(event.transaction_date || '').slice(0, 7);
  if (ym !== month) return false;
  if (!isCashInvestTicker(String(event.asset_ticker || ''))) return false;
  const ref = String(event.broker_note_ref || '');
  if (/OPENING:\d{4}-\d{2}-\d{2}/i.test(ref)) return false;
  if (ref.startsWith('BTG-EXT-')) return true;
  if (ref.includes('B3-NOTA') || ref.includes('BTG-NOTA') || ref.includes(':CASH')) return true;
  return false;
}

export function stripMonthImportCashFromLedger(
  events: LedgerEvent[],
  month: string
): LedgerEvent[] {
  return events.filter((e) => !isMonthBtgImportCashEvent(e, month));
}

/** Remove caixa BTG do mês alvo em diante (reimportação parcial sem duplicar meses posteriores). */
export function stripBtgImportCashFromMonthForward(
  events: LedgerEvent[],
  fromMonth: string
): LedgerEvent[] {
  return events.filter((e) => {
    const ym = String(e.transaction_date || '').slice(0, 7);
    if (ym < fromMonth) return true;
    return !isMonthBtgImportCashEvent(e, ym);
  });
}

/**
 * Livro para batimento do mês: remove caixa BTG do mês alvo em diante e projeta
 * cada movimento do extrato usando a série de saldo bruta (parseExtractCashSeries).
 *
 * Usar a série de saldo em vez de entradas classificadas individualmente garante
 * que entradas com descrição desconhecida (classificadas como 'skip') não criem
 * discrepância na simulação — cada linha do extrato afeta o saldo projetado
 * exatamente como afetaria o saldo real.
 */
export async function buildMonthReconcileLedger(
  month: string,
  extractFile: BtgUploadFileInput | undefined,
  baseLedger: LedgerEvent[]
): Promise<LedgerEvent[]> {
  const stripped = stripBtgImportCashFromMonthForward(baseLedger, month);

  if (extractFile?.contentBase64) {
    try {
      const { normalizedLines, openingBalance } = await getExtractNormalizedLines(extractFile);
      const block = extractMovementBlock(normalizedLines.join('\n'));
      const series = parseExtractCashSeries(block, openingBalance ?? undefined);

      let prevBalance = openingBalance ?? 0;
      const projectedEvents: LedgerEvent[] = [];
      for (let i = 0; i < series.length; i++) {
        const point = series[i]!;
        const signedCash = Math.round((point.balance - prevBalance) * 100) / 100;
        prevBalance = point.balance;
        if (Math.abs(signedCash) < 0.005) continue;
        projectedEvents.push({
          asset_id: `proj-ext-series-${point.date}-${i}`,
          asset_ticker: MAIN_CASH_TICKER,
          asset_type: 'cash',
          transaction_type: 'cash_yield' as LedgerTransactionType,
          transaction_date: point.date,
          quantity: 1,
          unit_price: signedCash,
          total_net_value: signedCash,
          broker_note_ref: `BTG-EXT-${point.date}#${String(i).padStart(3, '0')}`,
        });
      }
      return [...stripped, ...projectedEvents];
    } catch {
      /* parse falha */
    }
  }
  return stripped;
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

  const reconciled =
    Boolean(extract.parseOk) &&
    monthMatch &&
    extract.openingLedgerOk === true &&
    extract.closingLedgerOk === true;

  const financialOk = reconciled;

  const financialParts: string[] = [];
  if (!extract.parseOk) financialParts.push(extract.parseError || 'extrato ilegível');
  if (extractMonth && extractMonth !== month) {
    financialParts.push(`extrato parece ser ${extractMonth}, não ${month}`);
  }
  if (extract.monthAlreadyImported && reconciled) {
    financialParts.push(
      `mês importado · fecha OK · saldo fim extrato R$ ${extract.closingExtract?.toFixed(2) ?? '?'}`
    );
  } else if (extract.monthAlreadyImported) {
    financialParts.push('extrato deste mês já importado');
  }
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

  const resultOk = notesOk && reconciled;

  let resultDetail = '';
  if (resultOk) {
    resultDetail = extract.monthAlreadyImported
      ? 'Mês pronto para atualizar: notas e extrato batem; duplicados serão descartados e apenas novidades serão inseridas.'
      : 'Mês pronto para importar: notas e extrato coerentes com o livro (simulação pós-notas).';
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

export type PreviewBtgMonthImportOptions = {
  /** Livro simulado (prévia em lote). Se omitido, lê o banco. */
  baseLedger?: LedgerEvent[];
  /** Fechamento do extrato anterior na cadeia mensal. */
  previousClosingExtract?: number | null;
  /** Ignora BTG-EXT já gravados — simula purge + reimportação. */
  simulateFreshImport?: boolean;
};

/** Equivalente ao purge: só pernas de abertura (patrimônio + caixa OPENING). */
export function filterLedgerOpeningOnly(events: LedgerEvent[]): LedgerEvent[] {
  return events.filter((e) => {
    const ref = String(e.broker_note_ref || '');
    const type = String(e.transaction_type || '');
    if (type === 'opening_balance') return true;
    if (/OPENING:\d{4}-\d{2}-\d{2}/i.test(ref)) return true;
    return false;
  });
}

export async function previewBtgMonthImport(
  ctx: UserContext,
  ledger: LedgerImportService,
  month: string,
  extractFile: BtgUploadFileInput,
  noteFilesAll: BtgUploadFileInput[],
  opts?: PreviewBtgMonthImportOptions
): Promise<BtgMonthImportPreview> {
  const monthNorm = String(month || '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthNorm)) {
    throw new GatewayError('INVALID_PAYLOAD', 'Informe o mês no formato YYYY-MM.', 400);
  }
  if (!extractFile?.name || !extractFile?.contentBase64) {
    throw new GatewayError('INVALID_PAYLOAD', 'Envie o extrato do mês (PDF ou CSV).', 400);
  }

  const noteFiles = await resolveNoteFilesForMonth(
    noteFilesAll.filter((f) => isPdfPath(f.name)),
    monthNorm
  );

  const notes = await previewBtgBrokerageUpload(noteFiles);
  const today = new Date().toISOString().slice(0, 10);
  const dbLedger = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const baseLedger = opts?.baseLedger ?? dbLedger;
  const reconcileLedger = await buildMonthReconcileLedger(
    monthNorm,
    extractFile,
    baseLedger
  );

  const parsedExtract = await previewBtgExtractUpload(extractFile);
  let extract: BtgExtractFileResult = parsedExtract;

  if (parsedExtract.parseOk && parsedExtract.preview) {
    const parsed: ParsedExtractForBatch = {
      path: parsedExtract.path,
      fileName: parsedExtract.fileName,
      preview: parsedExtract.preview,
    };
    const recon = buildExtractReconcileFields(
      parsed,
      reconcileLedger,
      opts?.previousClosingExtract ?? null,
      {
        tolerance: MONTH_IMPORT_CASH_TOLERANCE,
      }
    );
    const monthAlreadyImported = opts?.simulateFreshImport
      ? false
      : isExtractMonthInLedger(dbLedger, monthNorm);
    extract = {
      ...parsedExtract,
      ...recon,
      monthAlreadyImported,
    };
  }

  const flags = evaluateMonthPreview(
    monthNorm,
    notes,
    extract,
    noteFilesAll.filter((f) => isPdfPath(f.name)).length,
    noteFiles.length
  );

  let liqBolsaOk = true;
  let liqBolsaDetail = '';
  if (noteFiles.length && extract.parseOk) {
    const liq = await assessLiqBolsaStrictForMonth(
      ctx,
      ledger,
      monthNorm,
      noteFiles,
      extractFile,
      { ignoreDbPending: opts?.simulateFreshImport === true }
    );
    liqBolsaOk = liq.ok;
    liqBolsaDetail = liq.detail;
  }

  const resultOk = flags.resultOk && liqBolsaOk;
  const resultDetail = liqBolsaOk ? flags.resultDetail : liqBolsaDetail;

  return {
    kind: 'month_import',
    month: monthNorm,
    ...flags,
    resultOk,
    resultDetail,
    liqBolsaOk,
    liqBolsaDetail,
    notesFilesInFolder: noteFilesAll.filter((f) => isPdfPath(f.name)).length,
    notesFilesInMonth: noteFiles.length,
    notes,
    extract,
  };
}

export type BtgBatchMonthStatus = 'ready' | 'blocked' | 'already_imported';

export type BtgBatchMonthPreview = BtgMonthImportPreview & {
  status: BtgBatchMonthStatus;
};

export type BtgBatchImportPreview = {
  kind: 'batch_import';
  months: BtgBatchMonthPreview[];
  monthsTotal: number;
  monthsReady: number;
  monthsBlocked: number;
  monthsAlreadyImported: number;
  chainOk: boolean;
  resultOk: boolean;
  summary: string;
  simulatedFreshImport: boolean;
};

export type PreviewBtgBatchImportOptions = {
  /** Simula purge + reimportação do período (ignora meses já no banco). */
  resetFirst?: boolean;
};

/**
 * Prévia de todos os meses detectados nos extratos — sem gravar.
 * Simula a cadeia mês a mês; com resetFirst, parte só da abertura.
 */
export async function previewBtgBatchImport(
  ctx: UserContext,
  ledger: LedgerImportService,
  noteFilesAll: BtgUploadFileInput[],
  extractFiles: BtgUploadFileInput[],
  options?: PreviewBtgBatchImportOptions
): Promise<BtgBatchImportPreview> {
  if (!extractFiles?.length) {
    throw new GatewayError('INVALID_PAYLOAD', 'Envie ao menos um extrato BTG.', 400);
  }
  if (!noteFilesAll?.length) {
    throw new GatewayError('INVALID_PAYLOAD', 'Envie ao menos um PDF de notas.', 400);
  }

  const plan = await discoverMonthExtractPlan(extractFiles);
  if (!plan.length) {
    throw new GatewayError(
      'INVALID_PAYLOAD',
      'Nenhum extrato BTG válido encontrado na pasta enviada.',
      400
    );
  }

  const resetFirst = options?.resetFirst === true;
  const today = new Date().toISOString().slice(0, 10);
  const dbLedger = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  let workingLedger = resetFirst ? filterLedgerOpeningOnly(dbLedger) : dbLedger;

  const months: BtgBatchMonthPreview[] = [];
  let prevClosing: number | null = null;
  let chainOk = true;

  for (const entry of plan) {
    const alreadyInDb = isExtractMonthInLedger(dbLedger, entry.month);
    const simulateFresh = resetFirst || !alreadyInDb;

    const preview = await previewBtgMonthImport(
      ctx,
      ledger,
      entry.month,
      entry.extractFile,
      noteFilesAll,
      {
        baseLedger: workingLedger,
        previousClosingExtract: prevClosing,
        simulateFreshImport: simulateFresh,
      }
    );

    if (
      prevClosing != null &&
      preview.extract.openingExtract != null &&
      Math.abs(preview.extract.openingExtract - prevClosing) > MONTH_IMPORT_CASH_TOLERANCE
    ) {
      chainOk = false;
    }
    if (preview.extract.closingExtract != null) {
      prevClosing = preview.extract.closingExtract;
    }

    let status: BtgBatchMonthStatus = 'blocked';
    if (preview.resultOk) {
      if (!resetFirst && alreadyInDb) {
        status = 'already_imported';
        workingLedger = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
      } else {
        status = 'ready';
        workingLedger = await buildMonthReconcileLedger(
          entry.month,
          entry.extractFile,
          workingLedger
        );
      }
    }

    months.push({ ...preview, status });
  }

  const monthsReady = months.filter((m) => m.status === 'ready').length;
  const monthsBlocked = months.filter((m) => m.status === 'blocked').length;
  const monthsAlreadyImported = months.filter((m) => m.status === 'already_imported').length;
  const resultOk =
    chainOk && monthsBlocked === 0 && (monthsReady > 0 || monthsAlreadyImported === months.length);

  const parts: string[] = [];
  parts.push(`${plan.length} mês(es): ${plan[0]!.month} → ${plan[plan.length - 1]!.month}`);
  if (resetFirst) {
    parts.push('simulação com limpeza (só abertura)');
  }
  if (monthsReady) parts.push(`${monthsReady} pronto(s) para importar`);
  if (monthsAlreadyImported) parts.push(`${monthsAlreadyImported} já importado(s)`);
  if (monthsBlocked) parts.push(`${monthsBlocked} com bloqueio`);
  if (!chainOk) parts.push('cadeia de saldos entre extratos quebrada');

  return {
    kind: 'batch_import',
    months,
    monthsTotal: months.length,
    monthsReady,
    monthsBlocked,
    monthsAlreadyImported,
    chainOk,
    resultOk,
    summary: parts.join(' · '),
    simulatedFreshImport: resetFirst,
  };
}

/** Linhas de import (com skip_financial_ledger) para backfill de expectativas pending. */
async function collectMonthImportLines(
  noteFiles: BtgUploadFileInput[]
): Promise<import('./ledgerTypes').LedgerImportLine[]> {
  const lines: import('./ledgerTypes').LedgerImportLine[] = [];
  for (const file of noteFiles) {
    if (!isPdfPath(file.name)) continue;
    try {
      const rawLines = await pdfBufferToLines(decodeUploadBase64(file));
      const notes = parseBtgBrokerageNoteBlocks(rawLines, file.name);
      const { kept } = dedupeBrokerageNotes(notes);
      lines.push(...suppressBrokerageNoteCashLines(brokerageNotesToLedgerLines(kept)));
    } catch {
      /* ilegível */
    }
  }
  return lines;
}

function isLiqBolsaExtractLine(line: LedgerImportLine): boolean {
  return /LIQ\s+BOLSA/i.test(String(line.notes || ''));
}

function signedCentsFromSkipFinancialLine(line: LedgerImportLine): number | null {
  if (line.skip_financial_ledger !== true) return null;
  if (!BROKERAGE_NOTE_CASH_OPS.has(line.operation as LedgerTransactionType)) return null;
  const signed =
    Math.round(
      Number(line.total_net_value ?? Number(line.quantity) * Number(line.unit_price)) * 100
    ) / 100;
  if (Math.abs(signed) < 0.01) return null;
  return Math.round(signed * 100);
}

export type LiqBolsaStrictAssessment = {
  ok: boolean;
  unresolved: Array<{ date: string; net: number; reason: string }>;
  detail: string;
};

/** Avalia casamento LIQ BOLSA a partir de pools de expectativa (testes e diagnostico). */
export function assessLiqBolsaFromPendingPools(
  month: string,
  pendingByDate: Record<string, number[]>,
  liqLines: Array<{ date: string; signedCents: number }>
): LiqBolsaStrictAssessment {
  const monthNorm = month.slice(0, 7);
  const pools: Record<string, number[]> = {};
  for (const [date, cents] of Object.entries(pendingByDate)) {
    pools[date] = [...cents];
  }

  const unresolved: LiqBolsaStrictAssessment['unresolved'] = [];
  const sorted = [...liqLines].sort(
    (a, b) => a.date.localeCompare(b.date) || a.signedCents - b.signedCents
  );

  for (const line of sorted) {
    const date = String(line.date).slice(0, 10);
    if (date.slice(0, 7) !== monthNorm) continue;
    const candidates = pools[date] ?? [];
    const consumed = consumeSignedCentsSubset(candidates, line.signedCents);
    if (consumed) {
      pools[date] = consumed.remaining;
      continue;
    }
    unresolved.push({
      date,
      net: line.signedCents / 100,
      reason: liqBolsaBlockReason(candidates, line.signedCents),
    });
  }

  if (!unresolved.length) return { ok: true, unresolved: [], detail: '' };

  const details = unresolved
    .slice(0, 5)
    .map((u) => `${u.date}: ${u.net} (${u.reason})`)
    .join('; ');
  return {
    ok: false,
    unresolved,
    detail:
      `LIQ BOLSA sem casamento com eventos de negocio (${unresolved.length}). ` +
      `Corrija notas/eventos pendentes antes de importar. ${details}`,
  };
}

/** Simula casamento LIQ BOLSA estrito (mesma regra do apply). */
export async function assessLiqBolsaStrictForMonth(
  ctx: UserContext,
  ledger: LedgerImportService,
  month: string,
  noteFiles: BtgUploadFileInput[],
  extractFile: BtgUploadFileInput,
  opts?: { ignoreDbPending?: boolean }
): Promise<LiqBolsaStrictAssessment> {
  const bounds = monthBounds(month);
  if (!bounds) return { ok: true, unresolved: [], detail: '' };

  const importLines = await collectMonthImportLines(noteFiles);
  const enriched = await ledger.enrichImportLinesForSettlement(ctx, importLines);

  const pendingByDate: Record<string, number[]> = opts?.ignoreDbPending
    ? {}
    : await ledger.listPendingSignedCentsBySettlement(ctx, bounds.from, bounds.to);

  for (const line of enriched) {
    const cents = signedCentsFromSkipFinancialLine(line);
    if (cents === null) continue;
    const settle = String(line.settlement_date ?? line.date).slice(0, 10);
    if (settle < bounds.from || settle > bounds.to) continue;
    if (!pendingByDate[settle]) pendingByDate[settle] = [];
    pendingByDate[settle]!.push(cents);
  }

  let liqLines: LedgerImportLine[] = [];
  let extractAssessError: string | null = null;
  try {
    const opening = await ledger.getOpeningLedgerBalance(ctx);
    liqLines = (
      await parseExtractUploadImportLines(
        extractFile,
        { includeLiqBolsa: true },
        opening ?? undefined,
        undefined,
        ctx,
        ledger
      )
    ).filter(isLiqBolsaExtractLine);
  } catch (err) {
    extractAssessError = err instanceof Error ? err.message : String(err);
  }

  if (extractAssessError) {
    return {
      ok: false,
      unresolved: [],
      detail: `Nao foi possivel simular LIQ BOLSA do extrato: ${extractAssessError}`,
    };
  }

  const monthNorm = month.slice(0, 7);
  const liqForPool = liqLines
    .filter((line) => String(line.date).slice(0, 7) === monthNorm)
    .map((line) => ({
      date: String(line.date).slice(0, 10),
      signedCents: Math.round(Number(line.total_net_value ?? 0) * 100),
    }));

  return assessLiqBolsaFromPendingPools(month, pendingByDate, liqForPool);
}

export type BtgMonthImportApplyOptions = {
  /** Fechamento do extrato do mês anterior (cadeia de saldos). */
  previousClosingExtract?: number | null;
  /** Ignora pending residual no banco na prévia (após purge / simulação limpa). */
  simulateFreshImport?: boolean;
};

export async function applyBtgMonthImport(
  ctx: UserContext,
  ledger: LedgerImportService,
  month: string,
  extractFile: BtgUploadFileInput,
  noteFilesAll: BtgUploadFileInput[],
  applyOpts?: BtgMonthImportApplyOptions
): Promise<BtgMonthImportApplyResult> {
  const previewOpts: PreviewBtgMonthImportOptions = {
    previousClosingExtract: applyOpts?.previousClosingExtract ?? null,
    simulateFreshImport: applyOpts?.simulateFreshImport === true,
  };
  const preview = await previewBtgMonthImport(
    ctx,
    ledger,
    month,
    extractFile,
    noteFilesAll,
    previewOpts
  );

  logMonthImportStdout(ctx.organizationId, 'PREVIEW', month, preview);

  if (!preview.notesOk || !preview.extract.parseOk) {
    const detail = preview.resultDetail || 'Corrija notas e extrato antes de gravar este mês.';
    logMonthImportStdout(ctx.organizationId, 'BLOCKED', month, preview, detail);
    return {
      ...preview,
      applied: false,
      notesInserted: 0,
      notesSkipped: 0,
      extractInserted: 0,
      extractSkipped: 0,
      resultDetail: detail,
    };
  }

  if (!preview.resultOk) {
    const detail =
      preview.resultDetail || 'Valide notas e extrato antes de gravar este mes.';
    logMonthImportStdout(ctx.organizationId, 'BLOCKED', month, preview, detail);
    return {
      ...preview,
      applied: false,
      notesInserted: 0,
      notesSkipped: 0,
      extractInserted: 0,
      extractSkipped: 0,
      resultDetail: detail,
    };
  }

  const noteFiles = await resolveNoteFilesForMonth(
    noteFilesAll.filter((f) => isPdfPath(f.name)),
    preview.month
  );

  const notesApply = await applyBtgBrokerageUpload(ctx, ledger, noteFiles);

  const importLines = await collectMonthImportLines(noteFiles);
  const backfill = await ledger.backfillPendingFinancialForImportLines(ctx, importLines);
  const monthBoundsDates = monthBounds(preview.month);
  const pendingByDay = monthBoundsDates
    ? await ledger.countPendingFinancialBySettlement(
        ctx,
        monthBoundsDates.from,
        monthBoundsDates.to
      )
    : {};
  logInvestStdout(
    'btg-import',
    ctx.organizationId,
    `PENDING_AFTER_NOTES month=${preview.month} backfilled=${backfill.backfilled} ` +
      `lines=${importLines.length} byDay=${JSON.stringify(pendingByDay)}`
  );

  await ledger.reconcileCustody(ctx);
  await ensureExtractDivergenceOperation(pool);
  const extractApply = await applyBtgExtractUpload(ctx, ledger, extractFile, {
    parseOptions: MONTH_IMPORT_EXTRACT_OPTS_APPLY,
    keepUnmatchedLiqBolsaAsCash: false,
  });

  const notesInserted = notesApply.totals.inserted;
  const notesSkipped = notesApply.totals.skipped;
  const extractInserted = extractApply.inserted ?? 0;
  const extractSkipped = extractApply.skipped ?? 0;

  const reconcileAfter = await ledger.reconcileCustody(ctx);

  const afterPreview = await previewBtgMonthImport(ctx, ledger, month, extractFile, noteFilesAll);
  const applied = Boolean(extractApply.importOk);

  const pendingNote = reconcileAfter.pendingSync
    ? ` trânsito: +${reconcileAfter.pendingSync.created}/-${reconcileAfter.pendingSync.cleared}.`
    : '';

  const resultDetail = applied
    ? `Importado: notas +${notesInserted}/-${notesSkipped}, extrato +${extractInserted}/-${extractSkipped}.${pendingNote}`
    : extractApply.importError || 'Falha ao gravar extrato.';

  logInvestStdout(
    'btg-import',
    ctx.organizationId,
    `${applied ? 'APPLIED' : 'FAILED'} month=${month} notes=+${notesInserted}/-${notesSkipped} ` +
      `extract=+${extractInserted}/-${extractSkipped} pdfs=${noteFiles.length} detail=${resultDetail}`
  );

  return {
    ...afterPreview,
    applied,
    notesInserted,
    notesSkipped,
    extractInserted,
    extractSkipped,
    financialOk: applied ? preview.financialOk : afterPreview.financialOk,
    resultOk: applied && preview.resultOk,
    resultDetail,
  };
}
