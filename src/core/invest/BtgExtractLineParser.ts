/**
 * Parser de linhas do extrato BTG (texto extraído do PDF).
 * Ignora liquidações agregadas de bolsa — o detalhe vem do myProfit / notas.
 */
const LFT_TICKER_RE = /LFT\s+(\d{2})\/(\d{2})\/(\d{4})/i;

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

function parseLftTicker(description: string): string {
  const match = description.match(LFT_TICKER_RE);
  if (!match) return 'LFT-20310301';
  const [, dd, mm, yyyy] = match;
  return `LFT-${yyyy}${mm}${dd}`;
}

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
      ticker: parseLftTicker(description),
      asset_type: 'fixed_income',
      notes: description,
    };
  }
  if (d.includes('VENDA DE TESOURO DIRETO')) {
    return {
      operation: 'sell',
      ticker: parseLftTicker(description),
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

export function getBtgOperationSign(operation: string, description: string): number {
  const d = description.toUpperCase();
  if (['buy', 'capital_withdrawal', 'penalty_b3'].includes(operation)) {
    return -1;
  }
  if (['sell', 'capital_deposit', 'cash_yield'].includes(operation)) {
    return 1;
  }
  if (operation === 'fee') {
    return d.includes('REEMBOLSO') ? 1 : -1;
  }
  if (operation === 'securities_lending') {
    if (d.includes('REMUNERAÇÃO') || d.includes('REMUNERACAO')) {
      return 1;
    }
    return -1;
  }
  return 1;
}

/**
 * Categoria do gasto no extrato (ver docs/architecture/business_events_integration_plan.md):
 *   1 = ligado a operacao patrimonial (vira cost_adjustment no ativo)
 *   2 = despesa recorrente agregada por mes (custodia mensal sem ticker)
 *   3 = movimento financeiro puro (TED, rendimento, capital)
 */
export type ExtractCategory = 1 | 2 | 3;

export type BtgExtractEntry = {
  date: string;
  ticker: string;
  operation: string;
  quantity: number;
  unit_price: number;
  total_net_value: number;
  asset_type?: string;
  underlying_ticker?: string;
  notes?: string;
  /**
   * Header agregador (business_events.source_ref). Multiplas pernas com a
   * mesma chave caem no MESMO business_events.id.
   *   - operacoes TD spot: 'BTG-TD:{date}:{ticker}'
   *   - IRRF/taxa custodia atrelados a TD: mesmo header da TD geradora
   *   - BTC PRIO3 (3 sub-tipos): 'BTG-BTC-PRIO3:{yyyy-mm}'
   *   - custodia mensal isolada: 'BTG-CUSTODIA-MENSAL:{yyyy-mm}'
   *   - TED / rendimento / multa: vazio (cada linha 1 header avulso)
   */
  event_source_ref?: string;
  /** Categoria do gasto (debug/observabilidade). */
  extract_category?: ExtractCategory;
  /** Se true e operation = 'cost_adjustment', custo sobe tambem o pmB. */
  applies_to_b3?: boolean;
};

function ymOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function eventSourceRefForTd(date: string, ticker: string): string {
  return `BTG-TD:${date}:${ticker}`;
}

function eventSourceRefForBtcPrio3(monthYM: string): string {
  return `BTG-BTC-PRIO3:${monthYM}`;
}

function eventSourceRefForCustodiaMensal(monthYM: string): string {
  return `BTG-CUSTODIA-MENSAL:${monthYM}`;
}

function eventSourceRefForIrrfOpcaoMensal(monthYM: string): string {
  return `BTG-IRRF-OPCAO-MENSAL:${monthYM}`;
}

/** IRRF retido especificamente sobre op de TD (descricao traz "Tesouro"). */
const IRRF_TD_DESC_RE = /IRRF\s+COBRADO\s+SOBRE\s+OPERACAO\s+DE\s+TESOURO/i;
/** IRRF Lei 11.033/04 sobre opcoes (VENDAS/DAY TRADE) — sem ticker na descricao. */
const IRRF_OPCAO_DESC_RE = /IRRF\s*-\s*LEI\s+11\.033.+OP[CÇ][AÃ]O/i;
const TAXA_TD_DESC_RE = /TAXA.+TESOURO|EMOLUMENTOS.+TESOURO|CUSTODIA.+TESOURO|CUST[ÓO]DIA.+TESOURO/i;
const IS_GENERIC_CUSTODY_RE = /(?:^|\s)(TAXA\s+DE\s+CUST|CUST[ÓO]DIA|REEMBOLSO\s+DE\s+CUST|TAXA\s+SOBRE\s+VALOR\s+EM\s+CUST)/i;
const BTC_PRIO3_DESC_RE = /BTC\s*PRIO3|CORRETAGEM\s*BTC|IR\s*-\s*BTC|TAXA.+BTC\s*PRIO3|REMUNERA[ÇC][ÃA]O.+BTC\s*PRIO3/i;
const NEG_PENALTY_RE = /JUROS\s+SOBRE\s+SALDO\s+NEGATIVO|IOF\s+SOBRE\s+SALDO\s+NEGATIVO/i;

export function btgLinesToImportEntries(
  lines: string[],
  openingBalance?: number
): BtgExtractEntry[] {
  const out: BtgExtractEntry[] = [];
  let prev = openingBalance ?? null;

  // Buffer: ultima operacao TD spot por mes (para amarrar IRRF/taxa relacionada).
  // Em D ha a operacao TD; em D+1/D+2 caem IRRF/taxa. Como o extrato vem
  // ordenado cronologicamente, ao processar IRRF ja temos a TD no buffer.
  const lastTdByYM = new Map<
    string,
    { date: string; ticker: string; event_source_ref: string }
  >();

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

    const sign = getBtgOperationSign(map.operation, parsed.description);
    const net = sign * Math.abs(parsed.movementAmount);
    const ym = ymOf(parsed.date);
    const upperDesc = parsed.description.toUpperCase();

    // Caso 1A — operacao TD spot (compra/venda): registra no buffer mensal.
    if (
      (map.operation === 'buy' || map.operation === 'sell') &&
      map.asset_type === 'fixed_income' &&
      map.ticker.startsWith('LFT-')
    ) {
      const ref = eventSourceRefForTd(parsed.date, map.ticker);
      lastTdByYM.set(ym, {
        date: parsed.date,
        ticker: map.ticker,
        event_source_ref: ref,
      });
      out.push({
        date: parsed.date,
        ticker: map.ticker,
        operation: map.operation,
        quantity: Math.abs(parsed.movementAmount),
        unit_price: 1,
        total_net_value: Math.round(net * 100) / 100,
        asset_type: map.asset_type,
        underlying_ticker: map.underlying_ticker,
        notes: map.notes ?? parsed.description,
        event_source_ref: ref,
        extract_category: 1,
      });
      continue;
    }

    // Caso 1B — IRRF retido sobre TD: vira cost_adjustment no LFT da TD geradora.
    if (IRRF_TD_DESC_RE.test(upperDesc) && lastTdByYM.has(ym)) {
      const td = lastTdByYM.get(ym)!;
      out.push({
        date: parsed.date,
        ticker: td.ticker,
        operation: 'cost_adjustment',
        quantity: 0,
        unit_price: Math.abs(parsed.movementAmount),
        total_net_value: Math.abs(parsed.movementAmount),
        asset_type: 'fixed_income',
        notes: parsed.description,
        event_source_ref: td.event_source_ref,
        extract_category: 1,
        applies_to_b3: false,
      });
      continue;
    }

    // Caso 1C — taxa/emolumentos/custodia explicitamente TD: cost_adjustment no LFT.
    if (TAXA_TD_DESC_RE.test(upperDesc) && lastTdByYM.has(ym)) {
      const td = lastTdByYM.get(ym)!;
      out.push({
        date: parsed.date,
        ticker: td.ticker,
        operation: 'cost_adjustment',
        quantity: 0,
        unit_price: Math.abs(parsed.movementAmount),
        total_net_value: Math.abs(parsed.movementAmount),
        asset_type: 'fixed_income',
        notes: parsed.description,
        event_source_ref: td.event_source_ref,
        extract_category: 1,
        applies_to_b3: false,
      });
      continue;
    }

    // Caso 1E — IRRF Lei 11.033/04 sobre OPCAO: agregado em header mensal.
    // TODO: matching com nota BTG do dia anterior pra atribuir ao ticker exato
    // da opcao vendida que gerou a retencao. Por enquanto, agrupa por mes em
    // BTG-IRRF-OPCAO-MENSAL:{ym} como header de cash_movement em CAIXA.
    if (IRRF_OPCAO_DESC_RE.test(upperDesc)) {
      out.push({
        date: parsed.date,
        ticker: map.ticker, // CAIXA-BTG
        operation: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: Math.round(net * 100) / 100,
        asset_type: map.asset_type,
        notes: map.notes ?? parsed.description,
        event_source_ref: eventSourceRefForIrrfOpcaoMensal(ym),
        extract_category: 1,
      });
      continue;
    }

    // Caso 1D — qualquer despesa BTC PRIO3 (corretagem, IR, taxa, remuneracao):
    // todas caem em 1 header mensal. Remuneracao positiva continua sendo
    // securities_lending (income); demais viram cost_adjustment em PRIO3.
    if (BTC_PRIO3_DESC_RE.test(upperDesc)) {
      const ref = eventSourceRefForBtcPrio3(ym);
      const isIncome = /REMUNERA[ÇC][ÃA]O/i.test(upperDesc);
      if (isIncome) {
        // Remuneracao de aluguel: income do caixa, agrupado no header mensal BTC.
        out.push({
          date: parsed.date,
          ticker: map.ticker,
          operation: 'securities_lending',
          quantity: 0,
          unit_price: 0,
          total_net_value: Math.round(net * 100) / 100,
          asset_type: map.asset_type,
          underlying_ticker: map.underlying_ticker ?? 'PRIO3',
          notes: map.notes ?? parsed.description,
          event_source_ref: ref,
          extract_category: 1,
        });
      } else {
        // Despesa BTC (corretagem aluguel, IR retido sobre remuneracao):
        // cost_adjustment em PRIO3.
        out.push({
          date: parsed.date,
          ticker: 'PRIO3',
          operation: 'cost_adjustment',
          quantity: 0,
          unit_price: Math.abs(parsed.movementAmount),
          total_net_value: Math.abs(parsed.movementAmount),
          asset_type: 'stock',
          underlying_ticker: 'PRIO3',
          notes: parsed.description,
          event_source_ref: ref,
          extract_category: 1,
          applies_to_b3: false,
        });
      }
      continue;
    }

    // Caso 2 — custodia/taxa generica sem ticker patrimonial: header mensal isolado.
    if (
      map.operation === 'fee' &&
      IS_GENERIC_CUSTODY_RE.test(parsed.description) &&
      !TAXA_TD_DESC_RE.test(upperDesc)
    ) {
      out.push({
        date: parsed.date,
        ticker: map.ticker,
        operation: map.operation,
        quantity: 0,
        unit_price: 0,
        total_net_value: Math.round(net * 100) / 100,
        asset_type: map.asset_type,
        notes: map.notes ?? parsed.description,
        event_source_ref: eventSourceRefForCustodiaMensal(ym),
        extract_category: 2,
      });
      continue;
    }

    // Caso 3 — multa/juros saldo negativo: header avulso por agora. TODO:
    // matchar com nota de corretagem do dia anterior pra ratear nos ativos
    // comprados (regra "multa entra no estrito e gerencial").
    if (NEG_PENALTY_RE.test(upperDesc)) {
      out.push({
        date: parsed.date,
        ticker: map.ticker,
        operation: 'penalty_b3',
        quantity: 0,
        unit_price: 0,
        total_net_value: Math.round(net * 100) / 100,
        asset_type: map.asset_type,
        notes: map.notes ?? parsed.description,
        extract_category: 3,
      });
      continue;
    }

    // Caso 3 — TED, rendimento, capital_*, demais: 1 header avulso por linha.
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
      extract_category: 3,
    });
  }

  return out;
}
