import fs from 'fs';
import { pdfBufferToText } from '../src/core/invest/btgPdfTextExtract';
import {
  parseExtractUploadImportLines,
  type BtgUploadFileInput,
} from '../src/core/invest/btgUploadImportService';
import type { LedgerImportLine, LedgerImportPayload } from '../src/core/invest/ledgerTypes';

const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+,\d{1,6}/g;

function clean(line: string): string {
  return line.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
}

function parseBr(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

function moneyValues(line: string): number[] {
  return [...line.matchAll(MONEY_RE)].map((m) => parseBr(m[0]));
}

function isoDate(raw: string): string {
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) throw new Error(`Data invalida: ${raw}`);
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${m[2]}-${m[1]}`;
}

function monthEnd(openingDate: string): string {
  const d = new Date(`${openingDate.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function parseFinalCashLine(
  lines: string[],
  closingDate: string
): { provisionedYield: number; finalBalance: number } {
  const closingBr = `${closingDate.slice(8, 10)}/${closingDate.slice(5, 7)}/${closingDate.slice(2, 4)}`;
  for (const line of lines) {
    if (!line.startsWith(closingBr)) continue;
    if (!/Saldo Final/i.test(line) || !/Rendimento Provisionado/i.test(line)) continue;
    const nums = moneyValues(line);
    if (nums.length >= 2) {
      return { provisionedYield: nums[0]!, finalBalance: nums[nums.length - 1]! };
    }
    return { provisionedYield: 0, finalBalance: nums[0] ?? 0 };
  }
  return { provisionedYield: 0, finalBalance: 0 };
}

function inferOptionStrike(ticker: string, fallback?: number): number | undefined {
  const suffix = ticker.match(/(\d+)$/)?.[1];
  if (!suffix) return fallback;
  if (suffix.length <= 2) return Number(suffix);
  if (suffix.length === 3 && suffix.endsWith('0')) return Number(suffix) / 10;
  return fallback;
}

function optionTypeFromText(text: string): 'put_sell' | 'call_sell' | 'put_buy' | 'call_buy' {
  const upper = text.toUpperCase();
  const isCall = upper.includes('CALL');
  const isSell = upper.includes('VENDA');
  if (isCall) return isSell ? 'call_sell' : 'call_buy';
  return isSell ? 'put_sell' : 'put_buy';
}

function eventRefForTradeDate(date: string): string {
  return `BTG-MONTHLY-TRADE:${date}`;
}

function ref(prefix: string, ...parts: Array<string | number>): string {
  return ['BTG-MONTHLY', prefix, ...parts].join(':');
}

function parseTransitIrrfLines(lines: string[]): LedgerImportLine[] {
  const entries: LedgerImportLine[] = [];
  let inTransit = false;
  let seq = 0;
  for (const line of lines) {
    if (/Valores em tr[aâ]nsito/i.test(line)) {
      inTransit = true;
      continue;
    }
    if (!inTransit) continue;
    if (/^Total\b/i.test(line)) {
      inTransit = false;
      continue;
    }
    const m = line.match(
      /^(\d{2}\/\d{2}\/\d{2})\s+LIQ BOLSA \(IRRF\)\s+-\s+Preg[aã]o:(\d{2}\/\d{2}\/\d{4})\s+(-?[\d.]+,\d{2})/i
    );
    if (!m) continue;
    seq += 1;
    const settlementDate = isoDate(m[1]!);
    const tradeDate = isoDate(m[2]!.replace(/\/(\d{4})$/, (_m, y) => `/${String(y).slice(2)}`));
    entries.push({
      date: tradeDate,
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      operation: 'pending_settlement',
      quantity: 0,
      unit_price: 0,
      total_net_value: parseBr(m[3]!),
      settlement_date: settlementDate,
      settlement_status: 'pending',
      broker_note_ref: ref('TRANSIT-IRRF', tradeDate, seq),
      event_source_ref: eventRefForTradeDate(tradeDate),
      source_system: 'btg_monthly_statement.transit',
      notes: 'IRRF em transito informado no demonstrativo BTG',
    });
  }
  return entries;
}

type LftLot = {
  acquisitionDate: string;
  quantity: number;
  buyPrice: number;
  buyValue: number;
  currentPrice: number;
  gross: number;
  ir: number;
  iof: number;
  net: number;
};

type OptionPosition = {
  ticker: string;
  assetType: 'option_put' | 'option_call';
  underlyingTicker: string;
  quantity: number;
  strike: number;
  expiration: string;
  unitPrice: number;
  marketValue: number;
};

function previousProvisionedYield(previousPayloadPath?: string): number {
  if (!previousPayloadPath) return 0;
  const previous = JSON.parse(fs.readFileSync(previousPayloadPath, 'utf8').replace(/^\uFEFF/, '')) as LedgerImportPayload;
  return (previous.entries || [])
    .filter((entry) => String(entry.broker_note_ref || '').includes('CASH-PROVISIONED-YIELD'))
    .reduce((sum, entry) => sum + Number(entry.total_net_value || 0), 0);
}

async function buildPayload(pdfPath: string, previousPayloadPath?: string): Promise<LedgerImportPayload> {
  const raw = await pdfBufferToText(fs.readFileSync(pdfPath));
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);

  const periodLine = lines.find((l) => /Periodo de|Período de/i.test(l));
  const periodMatch = periodLine?.match(/(\d{2}\/\d{2}\/\d{2})\s+(?:a|à)?\s*(\d{2}\/\d{2}\/\d{2})/i);
  const openingDate = periodMatch ? isoDate(periodMatch[1]!) : '2026-01-01';
  const closingDate = periodMatch ? isoDate(periodMatch[2]!) : monthEnd(openingDate);

  const summary = {
    fixedOpeningNet: 0,
    fixedClosingNet: 0,
    variableOpeningNet: 0,
    derivativeOpeningNet: 0,
    derivativeClosingNet: 0,
  };
  for (const line of lines) {
    if (/Rend.*Fix/i.test(line)) {
      const nums = moneyValues(line);
      if (nums.length >= 4) {
        summary.fixedOpeningNet = nums[1]!;
        summary.fixedClosingNet = nums[3]!;
      }
    }
    if (/Rend.*Vari/i.test(line)) {
      const nums = moneyValues(line);
      if (nums.length >= 2) summary.variableOpeningNet = nums[1]!;
    }
    if (/Derivativos/i.test(line)) {
      const nums = moneyValues(line);
      if (nums.length >= 4) {
        summary.derivativeOpeningNet = nums[1]!;
        summary.derivativeClosingNet = nums[3]!;
      }
    }
  }

  const openingCashLine = lines.find((l) => /Saldo\s+Anterior/i.test(l));
  const openingCash = openingCashLine ? moneyValues(openingCashLine)[0] ?? 0 : 0;

  const lftLots: LftLot[] = [];
  let pendingLftAcquisition: string | null = null;
  for (const line of lines) {
    const lotHeader = line.match(/^LFT\s+\d{2}\/\d{2}\/\d{2}\s+\d{2}\/\d{2}\/\d{2}\s+(\d{2}\/\d{2}\/\d{2})\b/);
    if (lotHeader) {
      pendingLftAcquisition = isoDate(lotHeader[1]!);
      continue;
    }
    if (pendingLftAcquisition && /^\d+(?:,\d+)?\s+\d{1,3}(?:\.\d{3})*,\d{4}/.test(line)) {
      const nums = moneyValues(line);
      if (nums.length >= 7) {
        lftLots.push({
          acquisitionDate: pendingLftAcquisition,
          quantity: nums[0]!,
          buyPrice: nums[1]!,
          buyValue: nums[2]!,
          currentPrice: nums[3]!,
          gross: nums[4]!,
          ir: nums[5]!,
          iof: nums.length >= 8 ? nums[6]! : 0,
          net: nums.length >= 8 ? nums[7]! : nums[6]!,
        });
      }
      pendingLftAcquisition = null;
    }
  }

  const lftTicker = 'LFT-20310301';
  const openingLftLots = lftLots.filter((lot) => lot.acquisitionDate < openingDate);
  const openingLftQty = openingLftLots.reduce((s, lot) => s + lot.quantity, 0);
  const finalLftQty = lftLots.reduce((s, lot) => s + lot.quantity, 0);

  const optionPositions: OptionPosition[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z]{4}[A-Z0-9]+)\s+([A-Z]{4}\d+)\s+(-?[\d.]+)\s+([\d,]+)\s+(\d{2}\/\d{2}\/\d{2})\s+(Put|Call)\s+(vend|compr)/i);
    if (!m) continue;
    const nums = moneyValues(line);
    const quantity = Number(m[3]!.replace(/\./g, ''));
    const strike = parseBr(m[4]!);
    const unitPrice = nums.length >= 2 ? nums[nums.length - 2]! : 0;
    const marketValue = nums.length >= 1 ? nums[nums.length - 1]! : 0;
    optionPositions.push({
      ticker: m[1]!.toUpperCase(),
      assetType: m[6]!.toUpperCase() === 'CALL' ? 'option_call' : 'option_put',
      underlyingTicker: m[2]!.toUpperCase(),
      quantity,
      strike,
      expiration: isoDate(m[5]!),
      unitPrice,
      marketValue,
    });
  }

  const entries: LedgerImportLine[] = [];
  const openingPositions: LedgerImportPayload['opening_positions'] = [
    {
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      quantity: 1,
      avg_price: openingCash,
      notes: 'Saldo anterior do extrato BTG mensal',
    },
  ];

  const yieldToReverse = previousProvisionedYield(previousPayloadPath);
  if (Math.abs(yieldToReverse) >= 0.005) {
    entries.push({
      date: openingDate,
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      operation: 'cash_yield',
      quantity: 0,
      unit_price: 0,
      total_net_value: -yieldToReverse,
      broker_note_ref: ref('CASH-PROVISIONED-YIELD-REVERSAL', openingDate),
      event_source_ref: ref('CASH-PROVISIONED-YIELD-REVERSAL', openingDate),
      source_system: 'btg_monthly_statement.cash',
      notes: 'Estorno do rendimento provisionado no fechamento anterior',
    });
  }

  if (openingLftQty > 0) {
    openingPositions.push({
      ticker: lftTicker,
      asset_type: 'fixed_income',
      quantity: Math.round(openingLftQty * 1000000) / 1000000,
      avg_price: summary.fixedOpeningNet / openingLftQty,
      notes: `Abertura inferida dos lotes anteriores a ${openingDate}`,
    });
  }

  let prio3SaleQty = 0;
  let prio3SalePrice = 0;
  for (const line of lines) {
    const m = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+VENDA\s+PRIO3\s+([\d.]+)\s+([\d,]+)\s+([\d.]+,\d{2})\s+([\d,]+)\s+([\d.]+,\d{2})/i);
    if (!m) continue;
    const date = isoDate(m[1]!);
    prio3SaleQty = Number(m[2]!.replace(/\./g, ''));
    prio3SalePrice = parseBr(m[3]!);
    const fees = parseBr(m[5]!);
    const net = parseBr(m[6]!);
    entries.push({
      date,
      ticker: 'PRIO3',
      asset_type: 'stock',
      underlying_ticker: 'PRIO3',
      operation: 'sell',
      quantity: prio3SaleQty,
      unit_price: prio3SalePrice,
      total_net_value: net,
      brokerage_fee: fees,
      skip_financial_ledger: true,
      broker_note_ref: ref('STOCK', date, 'PRIO3'),
      event_source_ref: eventRefForTradeDate(date),
      source_system: 'btg_monthly_statement',
      notes: 'Venda PRIO3 no extrato mensal BTG',
    });
  }
  if (prio3SaleQty > 0) {
    openingPositions.push({
      ticker: 'PRIO3',
      asset_type: 'stock',
      quantity: prio3SaleQty,
      avg_price: summary.variableOpeningNet / prio3SaleQty,
      underlying_ticker: 'PRIO3',
      notes: 'Abertura inferida pela venda integral de janeiro',
    });
  }

  const soldOptionTickers = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+(VENDA|COMPRA)\s+(Put|Call)\s+([A-Z]{4}[A-Z0-9]+)\s+(\d{2}\/\d{2}\/\d{2})\s+([\d,]+)\s+(-?[\d.]+)\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-|[\d,]+)/i);
    if (!m) continue;
    const date = isoDate(m[1]!);
    const ticker = m[4]!.toUpperCase();
    soldOptionTickers.add(ticker);
    const quantity = Math.abs(Number(m[7]!.replace(/\./g, '')));
    const premium = parseBr(m[6]!);
    const paidReceived = Math.abs(parseBr(m[8]!));
    const fees = m[10] === '-' ? 0 : Math.abs(parseBr(m[10]!));
    entries.push({
      date,
      ticker,
      asset_type: m[3]!.toUpperCase() === 'CALL' ? 'option_call' : 'option_put',
      underlying_ticker: 'PRIO3',
      operation: optionTypeFromText(line),
      quantity,
      unit_price: premium,
      total_net_value: paidReceived,
      brokerage_fee: fees,
      option_strike: inferOptionStrike(ticker),
      option_expiration: isoDate(m[5]!),
      skip_financial_ledger: true,
      broker_note_ref: ref('OPTION', date, ticker),
      event_source_ref: eventRefForTradeDate(date),
      source_system: 'btg_monthly_statement',
      notes: `Venda de opcao ${ticker} no extrato mensal BTG`,
    });
  }

  const openingOptionPositions = optionPositions.filter((pos) => !soldOptionTickers.has(pos.ticker));
  if (prio3SaleQty > 0) {
    openingOptionPositions.push({
      ticker: 'PRIOA407',
      assetType: 'option_call',
      underlyingTicker: 'PRIO3',
      quantity: -prio3SaleQty,
      strike: prio3SalePrice,
      expiration: '2026-01-16',
      unitPrice: 0,
      marketValue: 0,
    });
  }
  const totalOpeningNotional = openingOptionPositions.reduce(
    (s, pos) => s + Math.abs(pos.quantity) * pos.strike,
    0
  );
  for (const pos of openingOptionPositions) {
    const allocated =
      totalOpeningNotional > 0
        ? Math.abs(summary.derivativeOpeningNet) *
          ((Math.abs(pos.quantity) * pos.strike) / totalOpeningNotional)
        : 0;
    openingPositions.push({
      ticker: pos.ticker,
      asset_type: pos.assetType,
      quantity: pos.quantity,
      avg_price: allocated / Math.abs(pos.quantity || 1),
      underlying_ticker: pos.underlyingTicker,
      option_strike: pos.strike,
      notes: 'Abertura estimada proporcionalmente pelo notional das opcoes em aberto',
    });
  }

  for (const line of lines) {
    const m = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+VENCIMENTO DA OPCAO\s+(Put|Call)\s+(PRIO[A-Z0-9]+)\s+(\d{2}\/\d{2}\/\d{2})\s+-\s+([\d.]+)/i);
    if (!m) continue;
    const date = isoDate(m[1]!);
    const ticker = m[3]!.toUpperCase();
    entries.push({
      date,
      ticker,
      asset_type: m[2]!.toUpperCase() === 'CALL' ? 'option_call' : 'option_put',
      underlying_ticker: 'PRIO3',
      operation: m[2]!.toUpperCase() === 'CALL' ? 'call_buy' : 'put_buy',
      quantity: Number(m[5]!.replace(/\./g, '')),
      unit_price: 0,
      total_net_value: 0,
      skip_financial_ledger: true,
      broker_note_ref: ref('OPTION-EXPIRY', date, ticker),
      event_source_ref: eventRefForTradeDate(date),
      source_system: 'btg_monthly_statement',
      notes: `Vencimento sem exercicio ${ticker}`,
    });
  }

  for (const line of lines) {
    const m = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+EXERCICIO OPCAO\s+(Put|Call)\s+(PRIO[A-Z0-9]+)\s+\d{2}\/\d{2}\/\d{2}\s+-\s+([\d.]+)/i);
    if (!m) continue;
    const date = isoDate(m[1]!);
    const ticker = m[3]!.toUpperCase();
    entries.push({
      date,
      ticker,
      asset_type: m[2]!.toUpperCase() === 'CALL' ? 'option_call' : 'option_put',
      underlying_ticker: 'PRIO3',
      operation: m[2]!.toUpperCase() === 'CALL' ? 'call_buy' : 'put_buy',
      quantity: Number(m[4]!.replace(/\./g, '')),
      unit_price: 0,
      total_net_value: 0,
      skip_financial_ledger: true,
      broker_note_ref: ref('OPTION-EXERCISE-CLOSE', date, ticker),
      event_source_ref: eventRefForTradeDate(date),
      source_system: 'btg_monthly_statement',
      notes: `Baixa de opcao exercida ${ticker}`,
    });
  }

  let pendingMovementDate: string | null = null;
  let pendingMovementTicker: string | null = null;
  let buySeq = 0;
  for (const line of lines) {
    const datePrefix = line.match(/^(\d{2}\/\d{2}\/\d{2})(?:\b|$)/);
    if (datePrefix) {
      pendingMovementDate = isoDate(datePrefix[1]!);
      pendingMovementTicker = null;
      continue;
    }
    if (pendingMovementDate && line === 'LFT') {
      pendingMovementTicker = lftTicker;
      continue;
    }
    if (
      !pendingMovementDate ||
      pendingMovementTicker !== lftTicker ||
      !/^COMPRA DEFINITIVA/i.test(line)
    ) {
      continue;
    }
    const buy = line.match(
      /^COMPRA DEFINITIVA\s+([\d.,]+)\s+([\d.]+,\d{4,6})\s+([\d.]+,\d{2})\s+(?:-|[\d.]+,\d{2})\s+(?:-|[\d.]+,\d{2})\s+([\d.]+,\d{2})/i
    );
    if (!buy) continue;
    buySeq += 1;
    const quantity = parseBr(buy[1]!);
    const unitPrice = parseBr(buy[2]!);
    const net = parseBr(buy[4]!);
    entries.push({
      date: pendingMovementDate,
      ticker: lftTicker,
      asset_type: 'fixed_income',
      operation: 'buy',
      quantity,
      unit_price: unitPrice,
      total_net_value: -Math.abs(net),
      broker_note_ref: ref('LFT-BUY', pendingMovementDate, buySeq),
      event_source_ref: `BTG-TD:${pendingMovementDate}:${lftTicker}`,
      source_system: 'btg_monthly_statement',
      notes: 'Compra definitiva LFT no extrato mensal BTG',
    });
    pendingMovementDate = null;
    pendingMovementTicker = null;
  }

  if (finalLftQty > 0 && summary.fixedClosingNet > 0) {
    entries.push({
      date: closingDate,
      ticker: lftTicker,
      asset_type: 'fixed_income',
      operation: 'revaluation',
      quantity: 0,
      unit_price: summary.fixedClosingNet / finalLftQty,
      total_net_value: 0,
      broker_note_ref: ref('LFT-REVALUE', closingDate),
      event_source_ref: ref('REVALUE', closingDate, lftTicker),
      source_system: 'btg_monthly_statement',
      notes: 'Reavaliacao LFT pelo saldo liquido do demonstrativo BTG',
    });
  }

  for (const pos of optionPositions) {
    entries.push({
      date: closingDate,
      ticker: pos.ticker,
      asset_type: pos.assetType,
      underlying_ticker: pos.underlyingTicker,
      operation: 'revaluation',
      quantity: 0,
      unit_price: Math.abs(pos.marketValue) / Math.abs(pos.quantity || 1),
      total_net_value: 0,
      option_strike: pos.strike,
      option_expiration: pos.expiration,
      skip_financial_ledger: true,
      broker_note_ref: ref('OPTION-REVALUE', closingDate, pos.ticker),
      event_source_ref: ref('REVALUE', closingDate, pos.ticker),
      source_system: 'btg_monthly_statement',
      notes: 'Reavaliacao de opcao pelo valor de mercado do demonstrativo BTG',
    });
  }

  const upload: BtgUploadFileInput = {
    name: pdfPath.split(/[\\/]/).pop() || 'btg-monthly.pdf',
    contentBase64: fs.readFileSync(pdfPath).toString('base64'),
  };
  const cashLines = await parseExtractUploadImportLines(upload, { includeLiqBolsa: true });
  for (const line of cashLines) {
    if (line.asset_type === 'fixed_income' && (line.operation === 'buy' || line.operation === 'sell')) {
      continue;
    }
    const pregao = String(line.notes || '').match(/PREG[AÃ]O:(\d{2}\/\d{2}\/\d{4})/i)?.[1];
    const pregaoDate = pregao ? isoDate(pregao.replace(/\/(\d{4})$/, (_m, y) => `/${String(y).slice(2)}`)) : null;
    entries.push({
      ...line,
      broker_note_ref:
        line.broker_note_ref || ref('CASH', line.date, entries.length + 1),
      event_source_ref:
        line.operation === 'pending_settlement' && pregaoDate
          ? eventRefForTradeDate(pregaoDate)
          : line.event_source_ref,
      source_system: 'btg_monthly_statement.cash',
    } as LedgerImportLine);
  }

  entries.push(...parseTransitIrrfLines(lines));

  const finalCashLine = parseFinalCashLine(lines, closingDate);
  if (Math.abs(finalCashLine.provisionedYield) >= 0.005) {
    entries.push({
      date: closingDate,
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      operation: 'cash_yield',
      quantity: 0,
      unit_price: 0,
      total_net_value: finalCashLine.provisionedYield,
      broker_note_ref: ref('CASH-PROVISIONED-YIELD', closingDate),
      event_source_ref: ref('CASH-PROVISIONED-YIELD', closingDate),
      source_system: 'btg_monthly_statement.cash',
      notes: 'Rendimento provisionado no saldo final BTG',
    });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.operation === 'revaluation' && b.operation !== 'revaluation') return 1;
    if (a.operation !== 'revaluation' && b.operation === 'revaluation') return -1;
    return String(a.broker_note_ref || '').localeCompare(String(b.broker_note_ref || ''));
  });

  return {
    opening_date: openingDate,
    source_label: `BTG Mensal ${openingDate.slice(0, 7)}`,
    opening_positions: openingPositions,
    entries,
  };
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    throw new Error('Uso: ts-node scripts/build-btg-monthly-ledger-payload.ts <extrato.pdf> [payload-mes-anterior.json]');
  }
  const payload = await buildPayload(pdfPath, process.argv[3]);
  process.stdout.write(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
