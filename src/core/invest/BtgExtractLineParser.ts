/**
 * Parser de linhas do extrato BTG (texto extraído do PDF).
 * Ignora liquidações agregadas de bolsa — o detalhe vem do myProfit / notas.
 */
import { TESOURO_SELIC_2031_TICKER } from './tesouroDirectLedger';
import { TESOURO_SELIC_2031_TICKER } from './tesouroDirectLedger';

export type BtgParsedLine = {
  date: string;
  description: string;
  balance: number;
  movementAmount: number;
  /** Valor líquido com sinal: positivo = entra na conta. */
  signedCash: number;
};

const BR_NUMBER = /(\d{1,3}(?:\.\d{3})*,\d{2}|-\d{1,3}(?:\.\d{3})*,\d{2})/g;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/;

export function parseBrNumber(raw: string): number {
  const t = raw.trim().replace(/\./g, '').replace(',', '.');
  return Number(t);
}

export function parseBtgMovementLine(
  line: string,
  previousBalance: number | null
): BtgParsedLine | null {
  const m = line.match(DATE_RE);
  if (!m) return null;

  const [, dd, mm, yyyy, rest] = m;
  const numbers = [...rest.matchAll(BR_NUMBER)].map((x) => x[1]);
  if (numbers.length < 2) return null;

  /** BTG PDF: penúltimo = saldo após lançamento; último = valor do lançamento. */
  const balance = parseBrNumber(numbers[numbers.length - 2]!);
  const movementAmount = parseBrNumber(numbers[numbers.length - 1]!);
  const descEnd = rest.lastIndexOf(numbers[numbers.length - 2]!);
  const description = rest.slice(0, descEnd).trim();

  let signedCash = movementAmount;
  if (previousBalance != null && !Number.isNaN(previousBalance)) {
    const delta = Math.round((balance - previousBalance) * 100) / 100;
    signedCash = delta;
    if (description.toUpperCase().includes('TED ENVIADA')) {
      signedCash = -Math.abs(movementAmount);
    }
  }

  return {
    date: `${yyyy}-${mm}-${dd}`,
    description,
    balance,
    movementAmount,
    signedCash,
  };
}

export type BtgLedgerMapping = {
  operation: string;
  ticker: string;
  asset_type?: string;
  underlying_ticker?: string;
  skip?: boolean;
  notes?: string;
};

const CASH_TICKER = 'CAIXA-BTG';
const LFT_TICKER = TESOURO_SELIC_2031_TICKER;

/** Classifica linha do extrato → operação do livro-razão INVEST. */
export function classifyBtgDescription(description: string): BtgLedgerMapping {
  const d = description.toUpperCase();

  if (d.includes('LIQ BOLSA (OPERACOES)') || d.includes('LIQ BOLSA (OPERA')) {
    return { operation: 'skip', ticker: CASH_TICKER, skip: true };
  }
  if (d.includes('CONTA REMUNERADA - RESGATE')) {
    return { operation: 'skip', ticker: CASH_TICKER, skip: true };
  }

  if (d.includes('TED ENVIADA')) {
    return {
      operation: 'capital_withdrawal',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }
  if (d.includes('TED RECEBIDA') || d.includes('TED CREDITO')) {
    return {
      operation: 'capital_deposit',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('RENDIMENTO DISPONÍVEL') || d.includes('RENDIMENTO DISPONIVEL')) {
    return {
      operation: 'cash_yield',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: 'Remuneração saldo em conta',
    };
  }

  if (d.includes('JUROS SOBRE SALDO NEGATIVO') || d.includes('IOF SOBRE SALDO NEGATIVO')) {
    return {
      operation: 'penalty_b3',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('COMPRA DE TESOURO DIRETO')) {
    return {
      operation: 'buy',
      ticker: LFT_TICKER,
      asset_type: 'fixed_income',
      notes: description,
    };
  }
  if (d.includes('VENDA DE TESOURO DIRETO')) {
    return {
      operation: 'sell',
      ticker: LFT_TICKER,
      asset_type: 'fixed_income',
      notes: description,
    };
  }

  if (d.includes('IRRF COBRADO SOBRE OPERACAO DE TESOURO') || d.includes('IRRF - LEI 11.033')) {
    return {
      operation: 'fee',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }
  if (d.includes('IR - BTC')) {
    return {
      operation: 'fee',
      ticker: 'PRIO3',
      asset_type: 'stock',
      underlying_ticker: 'PRIO3',
      notes: description,
    };
  }

  if (d.includes('BTC PRIO3') || d.includes('CORRETAGEM BTC')) {
    return {
      operation: 'securities_lending',
      ticker: 'PRIO3',
      asset_type: 'stock',
      underlying_ticker: 'PRIO3',
      notes: description,
    };
  }

  if (
    d.includes('TAXA') ||
    d.includes('EMOLUMENTOS') ||
    d.includes('CUSTODIA') ||
    d.includes('CUSTÓDIA')
  ) {
    return {
      operation: 'fee',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  if (d.includes('REEMBOLSO DE CUSTÓDIA') || d.includes('REEMBOLSO DE CUSTODIA')) {
    return {
      operation: 'fee',
      ticker: CASH_TICKER,
      asset_type: 'cash',
      notes: description,
    };
  }

  return { operation: 'skip', ticker: CASH_TICKER, skip: true, notes: description };
}

export function btgLinesToImportEntries(
  lines: string[],
  openingBalance?: number
): Array<{
  date: string;
  ticker: string;
  operation: string;
  quantity: number;
  unit_price: number;
  total_net_value: number;
  asset_type?: string;
  underlying_ticker?: string;
  notes?: string;
}> {
  const out: Array<{
    date: string;
    ticker: string;
    operation: string;
    quantity: number;
    unit_price: number;
    total_net_value: number;
    asset_type?: string;
    underlying_ticker?: string;
    notes?: string;
  }> = [];

  let prev = openingBalance ?? null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('Saldo Inicial') || line.startsWith('Total de')) continue;

    if (line.startsWith('Saldo Inicial')) {
      const nums = [...line.matchAll(BR_NUMBER)].map((x) => parseBrNumber(x[1]!));
      if (nums[0] != null) prev = nums[0];
      continue;
    }

    const parsed = parseBtgMovementLine(line, prev);
    if (!parsed) continue;
    prev = parsed.balance;

    const map = classifyBtgDescription(parsed.description);
    if (map.skip || map.operation === 'skip') continue;

    let net = parsed.signedCash;
    if (map.operation === 'buy' || map.operation === 'sell') {
      net = map.operation === 'buy' ? -Math.abs(parsed.movementAmount) : Math.abs(parsed.movementAmount);
    }
    if (map.operation === 'capital_withdrawal') {
      net = -Math.abs(parsed.movementAmount);
    }
    if (map.operation === 'fee' || map.operation === 'penalty_b3') {
      net = -Math.abs(parsed.movementAmount);
      if (parsed.description.toUpperCase().includes('REEMBOLSO')) {
        net = Math.abs(parsed.movementAmount);
      }
    }

    const qty =
      map.operation === 'buy' || map.operation === 'sell'
        ? Math.abs(parsed.movementAmount)
        : 0;

    out.push({
      date: parsed.date,
      ticker: map.ticker,
      operation: map.operation,
      quantity: qty,
      unit_price: qty > 0 ? 1 : 0,
      total_net_value: Math.round(net * 100) / 100,
      asset_type: map.asset_type,
      underlying_ticker: map.underlying_ticker,
      notes: map.notes ?? parsed.description,
    });
  }

  return out;
}
