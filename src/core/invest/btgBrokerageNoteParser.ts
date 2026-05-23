/**
 * Parser de notas de corretagem BTG/Necton (PDF → texto).
 * Somente leitura para conferência — não grava no livro razão.
 */

import { inferAssetType, inferUnderlyingTicker, isOptionTicker } from './assetClassifier';

export type BtgNoteCategory = 'SPOT' | 'OPTIONS' | 'LOAN';

const B3_INSTRUMENT_SUFFIX = /^(ON|PN|CI|ES|UNT|DIR)$/i;

// Palavras que aparecem no market type e nunca são ticker de instrumento.
const MARKET_TYPE_WORDS = new Set([
  'VENDA', 'COMPRA', 'OPCAO', 'EXERC',
  'MERC', 'VISTA', 'TERMO', 'FRACIONA',
  'BOVESPA', 'CBLC', 'BMF',
]);

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

/** Taxas da nota agregadas (somente débitos reais; ignora subtotais a crédito). */
export type AggregatedNoteFees = {
  brokerage: number;
  settlement: number;
  registration: number;
  emoluments: number;
  bovespa: number;
  irrf: number;
  other: number;
  totalDebit: number;
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
  /** Líquido final da nota ("Líquido para DD/MM/AAAA") após todas as taxas. */
  netSettlement: number | null;
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
  if (MARKET_TYPE_WORDS.has(t)) return false;
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
  // Separa tokens colados no formato MM/YY(YY)TICKER (ex: "01/26PRIOM385" → ["01/26", "PRIOM385"])
  const tokens: string[] = [];
  for (const tok of middle.split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\d{2}\/\d{2,4})([A-Z][A-Z0-9]+)$/i);
    if (m) {
      tokens.push(m[1], m[2].toUpperCase());
    } else {
      tokens.push(tok);
    }
  }
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

  // Segunda chance: o maturity pode estar imediatamente antes do ticker (colado
  // no PDF e já separado pelo pre-processamento acima, ou separado por espaço).
  if (!maturity && tokens.length && /^\d{2}\/\d{2,4}$/.test(tokens[tokens.length - 1])) {
    maturity = tokens.pop()!;
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

function isNotAFeeLabel(label: string): boolean {
  return /valor das oper|valor l[ií]quido das opera|valor l[ií]quido para|títulos públ|títulos publ|observa|transfer[eê]ncia de ativos|taxa de transfer/i.test(
    label
  );
}

/** Subtotais a crédito no PDF BTG (ex.: "399,62 Total CBLC C") — não são taxa. */
function isSubtotalCreditLine(label: string, dc: 'C' | 'D'): boolean {
  if (/total cblc/i.test(label)) return true;
  if (dc !== 'C') return false;
  return /valor l[ií]quido das opera|valor l[ií]quido para/i.test(label);
}

function normalizeParsedFee(fee: BtgBrokerageNoteFee): BtgBrokerageNoteFee | null {
  if (isNotAFeeLabel(fee.label)) return null;
  if (isSubtotalCreditLine(fee.label, fee.dc)) return null;
  return fee;
}

/** Linha de taxa/emolumento no bloco "Resumo dos Negócios" (vários layouts BTG). */
export function parseFeeLine(line: string): BtgBrokerageNoteFee | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed || /^resumo/i.test(trimmed)) return null;
  if (/^1-BOVESPA\s/i.test(trimmed)) return null;

  const looksLikeFeeLabel = (label: string) =>
    /taxa|emolument|irrf|corretagem|corret\.|bovespa|cblc|registro|liquida|clearing|execu[cç][aã]o|despesa|iss\b|a\.n\.a/i.test(
      label
    ) && !/exerc\s+opc/i.test(label);

  let parsed: BtgBrokerageNoteFee | null = null;

  // 0,11 Taxa de liquidação/CCP D
  let m = trimmed.match(/^([\d.,]+)\s+(.+?)\s+([CD])$/i);
  if (m) {
    const amount = parseBrMoney(m[1]!);
    if (amount === 0 && !/0,00/.test(m[1]!)) return null;
    parsed = { label: m[2]!.trim(), amount, dc: m[3]!.toUpperCase() as 'C' | 'D' };
  }

  // Taxa de liquidação/CCP 0,11 D
  if (!parsed) {
    m = trimmed.match(/^(.+?)\s+([\d.,]+)\s+([CD])$/i);
    if (m && looksLikeFeeLabel(m[1]!)) {
      const amount = parseBrMoney(m[2]!);
      if (amount === 0 && !/0,00/.test(m[2]!)) return null;
      parsed = { label: m[1]!.trim(), amount, dc: m[3]!.toUpperCase() as 'C' | 'D' };
    }
  }

  // Emolumentos: R$ 0,14 D  |  Corret. Execução: R$ 0,15
  if (!parsed) {
    m = trimmed.match(/^(.+?):\s*R\$\s*([\d.,-]+)\s*([CD])?\s*$/i);
    if (m) {
      const amount = parseBrMoney(m[2]!);
      if (amount === 0 && !/0,00/.test(m[2]!)) return null;
      const dc = (m[3]?.toUpperCase() as 'C' | 'D' | undefined) || 'D';
      parsed = { label: m[1]!.trim(), amount, dc };
    }
  }

  return parsed ? normalizeParsedFee(parsed) : null;
}

/** Líquido final: "Líquido para 06/01/2026 C 399,48" */
export function parseNetSettlementLine(line: string): number | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  const m = trimmed.match(
    /^L[ií]quido para\s+(\d{2}\/\d{2}\/\d{4})\s+([CD])\s+([\d.,]+)/i
  );
  if (!m) return null;
  const amount = parseBrMoney(m[3]!);
  return m[2]!.toUpperCase() === 'C' ? amount : -amount;
}

function pickFeeDebit(fees: BtgBrokerageNoteFee[], pattern: RegExp): number | null {
  const hit = fees.find((f) => pattern.test(f.label) && f.dc === 'D');
  return hit ? Math.abs(hit.amount) : null;
}

/** Soma taxas reais (débitos) da nota; evita contar Total CBLC a crédito. */
export function aggregateNoteFees(note: BtgBrokerageNote): AggregatedNoteFees {
  const agg: AggregatedNoteFees = {
    brokerage: 0,
    settlement: 0,
    registration: 0,
    emoluments: 0,
    bovespa: 0,
    irrf: 0,
    other: 0,
    totalDebit: 0,
  };

  for (const f of note.fees) {
    if (f.dc !== 'D') continue;
    if (isNotAFeeLabel(f.label) || isSubtotalCreditLine(f.label, f.dc)) continue;
    const amt = Math.abs(f.amount);
    if (amt <= 0) continue;
    const u = f.label.toUpperCase();
    if (/CORRET|DESPESA|CLEARING|EXECU/i.test(u)) agg.brokerage += amt;
    else if (/IRRF|I\.R\.R\.F|IR S\/REND/i.test(u)) agg.irrf += amt;
    else if (/LIQUIDA|CCP/i.test(u)) agg.settlement += amt;
    else if (/REGISTRO/i.test(u)) agg.registration += amt;
    else if (/EMOLUMENT/i.test(u)) agg.emoluments += amt;
    else if (/BOVESPA|ANA|TERMO\/OP/i.test(u)) agg.bovespa += amt;
    else agg.other += amt;
  }

  if (agg.emoluments > 0 && agg.bovespa > 0 && Math.abs(agg.bovespa - agg.emoluments) < 0.02) {
    agg.bovespa = 0;
  }

  if (agg.totalDebit === 0) {
    agg.settlement = Math.abs(Number(note.settlementTax ?? 0));
    agg.registration = Math.abs(Number(note.registrationTax ?? 0));
    agg.emoluments = Math.abs(Number(note.emoluments ?? 0));
    agg.irrf = Math.abs(Number(note.irrf ?? 0));
    const bov = Math.abs(Number(note.bovespaTotal ?? 0));
    if (bov > 0 && Math.abs(bov - agg.emoluments) >= 0.02) agg.bovespa = bov;
  }

  agg.totalDebit =
    agg.brokerage +
    agg.settlement +
    agg.registration +
    agg.emoluments +
    agg.bovespa +
    agg.irrf +
    agg.other;

  return agg;
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
  const fees: BtgBrokerageNoteFee[] = [];

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

    for (const label of ['Emolumentos', 'I.R.R.F', 'Corret. Execução', 'Corret. Clearing']) {
      const v = parseLoanMoneyField(section, label);
      if (v != null && v > 0) {
        fees.push({ label, amount: v, dc: 'D' });
      }
    }

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
    fees,
    netOperations: noteNet > 0 ? noteNet : trades.reduce((s, t) => s + t.grossValue, 0),
    netSettlement: noteNet > 0 ? noteNet : null,
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
    let inFeeSection = false;
    let netSettlement: number | null = null;

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
      if (line!.startsWith('Negócios realizados')) {
        inTrades = true;
        inFeeSection = false;
      }
      if (line!.startsWith('Resumo dos Negócios') || line!.startsWith('Resumo Financeiro')) {
        inTrades = false;
        inFeeSection = true;
      }

      if (inTrades) {
        const trade = parseTradeLine(line);
        if (trade) trades.push(trade);
      }

      if (inFeeSection) {
        const fee = parseFeeLine(line);
        if (fee) fees.push(fee);
      }

      const net = parseNetSettlementLine(line!);
      if (net != null) netSettlement = net;
    }

    const pregaoDate = brDateToIso(pregaoRaw);
    const dedupeKey = `${cat}|${noteNumber}|${pregaoDate}`;
    const netOpsCredit = fees.find(
      (f) => /valor l[ií]quido das opera/i.test(f.label) && f.dc === 'C'
    );

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
      netOperations:
        netSettlement ??
        (netOpsCredit ? Math.abs(netOpsCredit.amount) : null),
      netSettlement,
      settlementTax: pickFeeDebit(fees, /taxa de liquida/i),
      registrationTax: pickFeeDebit(fees, /taxa de registro/i),
      cblcTotal: pickFeeDebit(fees, /^total cblc$/i),
      emoluments: pickFeeDebit(fees, /emolumentos/i),
      bovespaTotal: pickFeeDebit(fees, /total bovespa/i),
      irrf: pickFeeDebit(fees, /irrf|ir s\/rendimento/i),
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
