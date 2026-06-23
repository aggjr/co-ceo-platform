/**
 * Lotes LFT do extrato de investimento BTG (detalhamento por aquisição).
 * Extratos CC jan–mai não trazem qty/PU — cruzamos com Jun_2026.pdf (investimento).
 */
import fs from 'fs';
import path from 'path';
import { pdfBufferToText } from './btgPdfTextExtract';

// Sem ticker de cliente hardcoded: o titulo (LFT-AAAAMMDD) e derivado do
// vencimento que ja consta na propria linha do extrato de investimento.
// Grupos: 1=emissao, 2=vencimento, 3=aquisicao, 4=qtd, 5=PU compra, 6=valor compra.
const INLINE_LOT_RE =
  /LFT\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+[^L]*?SELIC[^0-9%]*[\d.,%]+\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/gi;

// Grupos: 1=emissao, 2=vencimento, 3=aquisicao.
const LINE_HEADER_RE =
  /^LFT\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\b/;

const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+,\d{1,6}/g;

export type LftInvestmentLot = {
  acquisitionDate: string;
  quantity: number;
  buyPrice: number;
  buyValue: number;
  ticker: string;
  /** Consumido ao casar compra TD no extrato CC. */
  used?: boolean;
};

export function parseBrNumberFlexible(raw: string): number {
  const s = String(raw).trim();
  if (!s) return NaN;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s);
}

export function brShortDateToIso(ddmmyy: string): string {
  const m = ddmmyy.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return '';
  return `20${m[3]!}-${m[2]!}-${m[1]!}`;
}

/** Ticker canonico LFT-AAAAMMDD derivado do vencimento (dd/mm/yy) da linha. */
export function lftTickerFromMaturityShort(maturityDdmmyy: string): string {
  const iso = brShortDateToIso(maturityDdmmyy);
  if (!iso) return '';
  return `LFT-${iso.replace(/-/g, '')}`;
}

export function parseLftInvestmentLotsInline(
  text: string,
  tickerOverride?: string
): LftInvestmentLot[] {
  const lots: LftInvestmentLot[] = [];
  for (const m of text.matchAll(INLINE_LOT_RE)) {
    const acquisitionDate = brShortDateToIso(m[3]!);
    const ticker = tickerOverride || lftTickerFromMaturityShort(m[2]!);
    if (!acquisitionDate || !ticker) continue;
    const quantity = parseBrNumberFlexible(m[4]!);
    const buyPrice = parseBrNumberFlexible(m[5]!);
    const buyValue = parseBrNumberFlexible(m[6]!);
    if (quantity <= 0 || buyPrice <= 0 || buyValue <= 0) continue;
    lots.push({ acquisitionDate, quantity, buyPrice, buyValue, ticker });
  }
  return lots;
}

export function parseLftInvestmentLotsFromLines(
  lines: string[],
  tickerOverride?: string
): LftInvestmentLot[] {
  const lots: LftInvestmentLot[] = [];
  let pendingAcquisition: string | null = null;
  let pendingTicker: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const header = line.match(LINE_HEADER_RE);
    if (header) {
      pendingAcquisition = brShortDateToIso(header[3]!);
      pendingTicker = tickerOverride || lftTickerFromMaturityShort(header[2]!);
      continue;
    }
    if (
      pendingAcquisition &&
      pendingTicker &&
      /^\d+(?:,\d+)?\s+\d{1,3}(?:\.\d{3})*,\d{4}/.test(line)
    ) {
      const nums = [...line.matchAll(MONEY_RE)].map((x) => parseBrNumberFlexible(x[0]));
      if (nums.length >= 3) {
        lots.push({
          acquisitionDate: pendingAcquisition,
          quantity: nums[0]!,
          buyPrice: nums[1]!,
          buyValue: nums[2]!,
          ticker: pendingTicker,
        });
      }
      pendingAcquisition = null;
      pendingTicker = null;
    }
  }
  return lots;
}

export function parseLftInvestmentLotsFromText(
  text: string,
  tickerOverride?: string
): LftInvestmentLot[] {
  const inline = parseLftInvestmentLotsInline(text, tickerOverride);
  if (inline.length) return inline;
  return parseLftInvestmentLotsFromLines(text.split(/\r?\n/), tickerOverride);
}

export function cloneLftInvestmentLots(lots: LftInvestmentLot[]): LftInvestmentLot[] {
  return lots.map((l) => ({ ...l, used: false }));
}

function daysBetweenIso(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T12:00:00Z`);
  const b = new Date(`${to.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 999;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Casa compra TD na CC com lote do extrato de investimento (liquidação T+1 típica). */
export function allocateLftLotForBuy(
  lots: LftInvestmentLot[],
  extractDate: string,
  ticker: string,
  financialAmount?: number,
  toleranceCents = 100
): LftInvestmentLot | undefined {
  const want = ticker.toUpperCase();
  const d = extractDate.slice(0, 10);
  const tolerance = toleranceCents / 100;
  const candidates = lots.filter(
    (l) =>
      !l.used &&
      l.ticker.toUpperCase() === want &&
      daysBetweenIso(l.acquisitionDate, d) >= 0 &&
      daysBetweenIso(l.acquisitionDate, d) <= 5
  );
  if (!candidates.length) return undefined;

  if (financialAmount != null && financialAmount > 0.005) {
    const byValue = candidates.filter(
      (l) => Math.abs(l.buyValue - financialAmount) <= tolerance
    );
    if (!byValue.length) return undefined;
    byValue.sort(
      (a, b) =>
        Math.abs(a.buyValue - financialAmount) - Math.abs(b.buyValue - financialAmount) ||
        daysBetweenIso(a.acquisitionDate, d) - daysBetweenIso(b.acquisitionDate, d)
    );
    const hit = byValue[0]!;
    hit.used = true;
    return hit;
  }

  candidates.sort(
    (a, b) => daysBetweenIso(a.acquisitionDate, d) - daysBetweenIso(b.acquisitionDate, d)
  );
  const hit = candidates[0]!;
  hit.used = true;
  return hit;
}

export async function loadLftInvestmentLotsFromDados(dadosDir?: string): Promise<LftInvestmentLot[]> {
  const base =
    dadosDir || process.env.BTG_DADOS_DIR || path.join(process.cwd(), 'Dados do Homebroker');
  const candidates = [
    path.join(base, 'Extratos Financeiros', 'Jun_2026.pdf'),
    path.join(base, 'Jun_2026.pdf'),
    path.join(base, 'Extratos Financeiros', 'Jun_2026.txt'),
  ];
  const txtPath = candidates.find((p) => /\.txt$/i.test(p) && fs.existsSync(p));
  if (txtPath) {
    const raw = fs.readFileSync(txtPath, 'latin1');
    const lots = parseLftInvestmentLotsFromText(raw);
    if (lots.length) return lots;
  }
  const pdfPath = candidates.find((p) => /\.pdf$/i.test(p) && fs.existsSync(p));
  if (!pdfPath) return [];

  const buffer = fs.readFileSync(pdfPath);
  const text = await pdfBufferToText(buffer);
  return parseLftInvestmentLotsFromText(text);
}
