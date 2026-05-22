/**
 * Parser de notas de corretagem BTG/Necton (PDF → texto).
 * Somente leitura para conferência — não grava no livro razão.
 */

import { inferAssetType, inferUnderlyingTicker, isOptionTicker } from './assetClassifier';

export type BtgNoteCategory = 'SPOT' | 'OPTIONS' | 'LOAN';

const B3_INSTRUMENT_SUFFIX = /^(ON|PN|CI|ES|UNT|DIR)$/i;

export type BtgBrokerageNoteTrade = {
  negotiation: string;
  side: 'C' | 'V';
  marketType: string;
  operationLabel: string;
  sideLabel: string;
  maturity: string | null;
  specification: string;
  /** Opção negociada ou exercida (nunca só "ON"). */
  ticker: string;
  /** Ação de referência (ex.: PRIO3). */
  underlyingStock: string;
  isExercise: boolean;
  quantity: number;
  unitPrice: number;
  grossValue: number;
  dc: 'C' | 'D';
};

export type BtgBrokerageNoteFee = {
  label: string;
  amount: number;
  dc: 'C' | 'D';
};

export type BtgBrokerageNote = {
  dedupeKey: string;
  noteNumber: string;
  sheet: string;
  pregaoDate: string;
  category: BtgNoteCategory;
  sourceFile: string;
  clientCode: string;
  trades: BtgBrokerageNoteTrade[];
  fees: BtgBrokerageNoteFee[];
  netOperations: number | null;
  settlementTax: number | null;
  registrationTax: number | null;
  cblcTotal: number | null;
  emoluments: number | null;
  bovespaTotal: number | null;
  irrf: number | null;
  duplicateSkipped: boolean;
  duplicateOf: string | null;
};

export function parseBrMoney(value: string): number {
  const t = value.trim();
  if (!t || t === '-') return 0;
  const neg = t.startsWith('-') || t.endsWith('-');
  const n = Number(t.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return neg && n > 0 ? -n : n;
}

export function parseBrQuantity(value: string): number {
  return parseBrMoney(value);
}

function brDateToIso(ddmmyyyy: string): string {
  const m = ddmmyyyy.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return ddmmyyyy;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function isoDateToBr(iso: string): string {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function looksLikeInstrumentToken(token: string): boolean {
  const t = token.toUpperCase();
  if (B3_INSTRUMENT_SUFFIX.test(t)) return false;
  if (/^\d{2}\/\d{2,4}$/.test(t)) return false;
  return /^[A-Z]{4}[A-Z0-9]{0,6}E?$/i.test(t) && t.length >= 5;
}

function resolveOperationLabel(marketTypeRaw: string): string {
  const u = marketTypeRaw.toUpperCase();
  if (/EXERC/i.test(u)) return 'Exercício';
  if (/OPCAO\s+DE\s+VENDA/i.test(u)) return 'Venda opção';
  if (/OPCAO\s+DE\s+COMPRA/i.test(u)) return 'Compra opção';
  if (/LOCA/i.test(u)) return 'Locação';
  return marketTypeRaw.trim() || '—';
}

function resolveSideLabel(side: 'C' | 'V', marketTypeRaw: string, isExercise: boolean): string {
  const u = marketTypeRaw.toUpperCase();
  if (isExercise) {
    if (u.includes('COMPRA')) return 'Compra';
    if (u.includes('VENDA')) return 'Venda';
  }
  return side === 'C' ? 'Compra' : 'Venda';
}

function parseTradeMiddle(middle: string, side: 'C' | 'V') {
  const tokens = middle.split(/\s+/).filter(Boolean);
  let suffix = '';
  if (tokens.length && B3_INSTRUMENT_SUFFIX.test(tokens[tokens.length - 1])) {
    suffix = tokens.pop()!.toUpperCase();
  }

  let maturity: string | null = null;
  if (tokens.length && /^\d{2}\/\d{2,4}$/.test(tokens[tokens.length - 1])) {
    maturity = tokens.pop()!;
  }

  let instrument = '';
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (looksLikeInstrumentToken(tokens[i])) {
      instrument = tokens[i].toUpperCase();
      tokens.splice(i, 1);
      break;
    }
  }

  const marketTypeRaw = tokens.join(' ').trim();
  const isExercise = /EXERC/i.test(marketTypeRaw);
  const operationLabel = resolveOperationLabel(marketTypeRaw);
  const sideLabel = resolveSideLabel(side, marketTypeRaw, isExercise);

  const ticker = instrument || '—';
  const underlyingStock = isExercise || isOptionTicker(ticker)
    ? inferUnderlyingTicker(ticker)
    : inferAssetType(ticker) === 'stock'
      ? ticker
      : inferUnderlyingTicker(ticker);

  const specification = [marketTypeRaw, maturity, ticker, suffix].filter(Boolean).join(' ').trim();

  return {
    marketType: marketTypeRaw,
    operationLabel,
    sideLabel,
    maturity,
    ticker,
    suffix,
    underlyingStock,
    isExercise,
    specification,
  };
}

function inferCategoryFromPath(filePath: string): BtgNoteCategory {
  const p = filePath.replace(/\\/g, '/').toUpperCase();
  if (p.includes('/LOAN/') || p.includes('ALUGUEL')) return 'LOAN';
  if (p.includes('/OPTIONS/') || p.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

function parseTradeLine(line: string): BtgBrokerageNoteTrade | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed.startsWith('1-BOVESPA')) return null;
  // No PDF cru, o lado (C/V) frequentemente vem colado na palavra seguinte:
  // "1-BOVESPA VEXERC OPC COMPRA ..." ou "1-BOVESPA VOPCAO DE VENDA ...".
  // Por isso aceitamos \s* (zero ou mais espaços) entre o C/V e o resto.
  const m = trimmed.match(
    /^1-BOVESPA\s+([CV])\s*(.+?)\s+([\d.]+,\d{2}|\d+,\d{2}|\d+)\s+([\d.,]+)\s+([\d.,]+)\s+([CD])$/
  );
  if (!m) return null;

  const side = m[1] as 'C' | 'V';
  const middle = m[2].trim();
  const quantity = parseBrQuantity(m[3]);
  const unitPrice = parseBrMoney(m[4]);
  const grossValue = parseBrMoney(m[5]);
  const dc = m[6] as 'C' | 'D';

  const parsed = parseTradeMiddle(middle, side);

  return {
    negotiation: '1-BOVESPA',
    side,
    marketType: parsed.marketType,
    operationLabel: parsed.operationLabel,
    sideLabel: parsed.sideLabel,
    maturity: parsed.maturity,
    specification: parsed.specification,
    ticker: parsed.ticker,
    underlyingStock: parsed.underlyingStock,
    isExercise: parsed.isExercise,
    quantity,
    unitPrice,
    grossValue,
    dc,
  };
}

function parseFeeLine(line: string): BtgBrokerageNoteFee | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  const m = trimmed.match(/^([\d.,]+)\s+(.+?)\s+([CD])$/);
  if (!m) return null;
  const amount = parseBrMoney(m[1]);
  if (amount === 0 && !/0,00/.test(m[1])) return null;
  return { label: m[2].trim(), amount, dc: m[3] as 'C' | 'D' };
}

function pickFeeAmount(fees: BtgBrokerageNoteFee[], pattern: RegExp): number | null {
  const hit = fees.find((f) => pattern.test(f.label));
  return hit ? hit.amount : null;
}

function parseLoanMoneyField(section: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m =
    section.match(new RegExp(`${escaped}:\\s*R\\$\\s*([\\d.,-]+)`, 'i')) ||
    section.match(new RegExp(`${escaped}\\s+R\\$\\s*([\\d.,-]+)`, 'i'));
  if (!m) return null;
  return parseBrMoney(m[1]);
}

function parseLoanContractSections(blockText: string): string[] {
  const parts = blockText.split(/(?=Lado\s+(?:Doador|Tomador)\s)/i).map((p) => p.trim()).filter(Boolean);
  return parts.filter((p) => /^Lado\s+(?:Doador|Tomador)/i.test(p));
}

function parseLoanBlock(block: string[], sourceFile: string): BtgBrokerageNote | null {
  const text = block.join('\n');
  const noteNumber = text.match(/N[uú]mero da Nota\s*(\d+)/i)?.[1] || '';
  const pregaoRaw = text.match(/Data de Liquida[cç][aã]o\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '';
  const pregaoDate = brDateToIso(pregaoRaw);
  if (!noteNumber || !pregaoDate) return null;

  const dedupeKey = `LOAN|${noteNumber}|${pregaoDate}`;
  const trades: BtgBrokerageNoteTrade[] = [];

  for (const section of parseLoanContractSections(text)) {
    const isDoador = /Lado\s+Doador/i.test(section);
    if (!isDoador) continue;

    const netReceived = parseLoanMoneyField(section, 'Valor Líquido');
    if (netReceived == null || netReceived <= 0) continue;

    const ticker = section.match(/Papel:\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase() || '—';
    const qty = parseBrQuantity(section.match(/Qtd\.\s*Original:\s*([\d.]+)/i)?.[1] || '0');
    const contractType = section.match(/Tipo do Contrato\s+([^\n]+)/i)?.[1]?.trim() || '';
    const maturity = section.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || null;
    const contractId = section.match(/Contrato:\s*(\S+)/i)?.[1] || '';

    trades.push({
      negotiation: 'ALUGUEL',
      side: 'C',
      marketType: 'LOCAÇÃO BTC',
      operationLabel: 'Locação',
      sideLabel: 'Recebimento',
      maturity,
      specification: [contractType, contractId].filter(Boolean).join(' '),
      ticker,
      underlyingStock: ticker,
      isExercise: false,
      quantity: qty,
      unitPrice: qty > 0 ? netReceived / qty : netReceived,
      grossValue: netReceived,
      dc: 'C',
    });
  }

  const noteNet =
    parseLoanMoneyField(text.slice(text.indexOf('Resumo financeiro')), 'Valor líquido') ??
    parseLoanMoneyField(text, 'Valor líquido') ??
    trades.reduce((s, t) => s + t.grossValue, 0);

  return {
    dedupeKey,
    noteNumber,
    sheet: '1',
    pregaoDate,
    category: 'LOAN',
    sourceFile,
    clientCode: '004176105',
    trades,
    fees: [],
    netOperations: noteNet > 0 ? noteNet : trades.reduce((s, t) => s + t.grossValue, 0),
    settlementTax: null,
    registrationTax: null,
    cblcTotal: null,
    emoluments: null,
    bovespaTotal: null,
    irrf: null,
    duplicateSkipped: false,
    duplicateOf: null,
  };
}

export function parseBtgBrokerageNoteBlocks(
  lines: string[],
  sourceFile: string,
  category?: BtgNoteCategory
): BtgBrokerageNote[] {
  const cat = category ?? inferCategoryFromPath(sourceFile);
  const notes: BtgBrokerageNote[] = [];
  const blocks: string[][] = [];
  const loanBlocks: string[][] = [];
  let current: string[] = [];
  let loanCurrent: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === 'NOTA DE CORRETAGEM') {
      if (loanCurrent.length) {
        loanBlocks.push(loanCurrent);
        loanCurrent = [];
      }
      if (current.length) blocks.push(current);
      current = [line];
      continue;
    }
    if (line === 'NOTA DE EMPRÉSTIMO' || line === 'NOTA DE EMPRESTIMO') {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      if (loanCurrent.length) loanBlocks.push(loanCurrent);
      loanCurrent = [line];
      continue;
    }
    if (loanCurrent.length) loanCurrent.push(line);
    else if (current.length) current.push(line);
  }
  if (current.length) blocks.push(current);
  if (loanCurrent.length) loanBlocks.push(loanCurrent);

  for (const lb of loanBlocks) {
    const loan = parseLoanBlock(lb, sourceFile);
    if (loan?.noteNumber) notes.push(loan);
  }

  for (const block of blocks) {
    // No PDF cru, "27994603 Nr. nota" vem em UMA linha; em amostras de teste
    // vem em duas. Tentamos os dois formatos: pega digitos iniciais da segunda
    // linha do bloco, ou da linha imediatamente antes de "Nr. nota".
    const firstDigits = (s: string) => (s.match(/^(\d{6,})/) || [, ''])[1] || '';
    let noteNumber = firstDigits(block[1] || '');
    let sheet = '';
    let pregaoRaw = '';
    let clientCode = '004176105';
    const trades: BtgBrokerageNoteTrade[] = [];
    const fees: BtgBrokerageNoteFee[] = [];
    let inTrades = false;

    for (let i = 0; i < block.length; i++) {
      const line = block[i];
      // "<digits> Nr. nota" em UMA linha
      const numNrInline = line!.match(/^(\d{6,})\s+Nr\.?\s*nota/i);
      if (numNrInline) noteNumber = numNrInline[1]!;
      // "Nr. nota" em linha propria, com noteNumber na anterior
      if (line === 'Nr. nota' && block[i - 1]) {
        const prev = firstDigits(block[i - 1] || '');
        if (prev) noteNumber = prev;
      }
      // "<sheet> Folha" em UMA linha
      const folhaInline = line!.match(/^(\d+)\s+Folha/i);
      if (folhaInline) sheet = folhaInline[1]!;
      if (line === 'Nr. nota' && block[i + 2] === 'Folha') sheet = block[i + 1] || '';
      // "DD/MM/YYYY Data pregão" em UMA linha
      const dateInline = line!.match(/^(\d{2}\/\d{2}\/\d{4})\s+Data\s+preg[aã]o/i);
      if (dateInline) pregaoRaw = dateInline[1]!;
      if (line === 'Data pregão' && block[i - 1]) pregaoRaw = block[i - 1];
      if (/^004176105$/.test(line!)) clientCode = line!;
      if (line!.startsWith('Negócios realizados')) inTrades = true;
      if (line!.startsWith('Resumo dos Negócios')) inTrades = false;

      if (inTrades) {
        const trade = parseTradeLine(line);
        if (trade) trades.push(trade);
      }

      const fee = parseFeeLine(line);
      if (fee) fees.push(fee);
    }

    const pregaoDate = brDateToIso(pregaoRaw);
    const dedupeKey = `${cat}|${noteNumber}|${pregaoDate}`;

    notes.push({
      dedupeKey,
      noteNumber,
      sheet,
      pregaoDate,
      category: cat,
      sourceFile,
      clientCode,
      trades,
      fees,
      netOperations: pickFeeAmount(fees, /valor l[ií]quido das opera/i),
      settlementTax: pickFeeAmount(fees, /taxa de liquida/i),
      registrationTax: pickFeeAmount(fees, /taxa de registro/i),
      cblcTotal: pickFeeAmount(fees, /total cblc/i),
      emoluments: pickFeeAmount(fees, /emolumentos/i),
      bovespaTotal: pickFeeAmount(fees, /total bovespa/i),
      irrf: pickFeeAmount(fees, /irrf|ir s\/rendimento/i),
      duplicateSkipped: false,
      duplicateOf: null,
    });
  }

  return notes;
}

export function dedupeBrokerageNotes(notes: BtgBrokerageNote[]): {
  kept: BtgBrokerageNote[];
  skipped: BtgBrokerageNote[];
} {
  const seen = new Map<string, BtgBrokerageNote>();
  const kept: BtgBrokerageNote[] = [];
  const skipped: BtgBrokerageNote[] = [];

  for (const note of notes) {
    const prev = seen.get(note.dedupeKey);
    if (prev) {
      note.duplicateSkipped = true;
      note.duplicateOf = prev.dedupeKey;
      skipped.push(note);
      continue;
    }
    seen.set(note.dedupeKey, note);
    kept.push(note);
  }

  return { kept, skipped };
}

export function flattenNotesForReview(notes: BtgBrokerageNote[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const note of notes) {
    const base = {
      dedupeKey: note.dedupeKey,
      noteNumber: note.noteNumber,
      pregaoDate: note.pregaoDate,
      pregaoDateBr: isoDateToBr(note.pregaoDate),
      sheet: note.sheet,
      category: note.category,
      sourceFile: note.sourceFile,
      netOperations: note.netOperations,
      settlementTax: note.settlementTax,
      registrationTax: note.registrationTax,
      cblcTotal: note.cblcTotal,
      emoluments: note.emoluments,
      bovespaTotal: note.bovespaTotal,
      irrf: note.irrf,
      duplicateSkipped: note.duplicateSkipped,
      duplicateOf: note.duplicateOf,
    };
    if (!note.trades.length) continue;
    note.trades.forEach((t, idx) => {
      rows.push({
        ...base,
        lineNo: idx + 1,
        side: t.side,
        sideLabel: t.sideLabel,
        marketType: t.marketType,
        operationLabel: t.operationLabel,
        maturity: t.maturity,
        ticker: t.ticker,
        underlyingStock: t.underlyingStock,
        isExercise: t.isExercise,
        specification: t.specification,
        quantity: t.quantity,
        unitPrice: t.unitPrice,
        grossValue: t.grossValue,
        dc: t.dc,
      });
    });
  }
  return rows.sort((a, b) => {
    const d = String(a.pregaoDate).localeCompare(String(b.pregaoDate));
    if (d !== 0) return d;
    return String(a.noteNumber).localeCompare(String(b.noteNumber));
  });
}
