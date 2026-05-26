/**
 * Agregação de opções vendidas (previsão / panorama).
 * PUTs: faixas ITM + % customizáveis → necessidade de caixa (negativo na síntese).
 * CALLs: síntese de caixa só ITM; tabela mostra todas as faixas.
 */
import { cardFieldRows } from './optionPortfolioModel.js';
import { isOptionInTheMoney, optionDistancePct } from './optionPortfolioModel.js';
import {
  filterOpenPortfolioItems,
  splitPortfolioBySheet,
} from './portfolioDisplay.js';

export const DEFAULT_PANORAMA_THRESHOLDS = { pct1: 5, pct2: 10 };

function emptyUnderlyingRow(underlying) {
  return {
    underlying,
    notionalItm: 0,
    notionalCumPct1: 0,
    notionalCumPct2: 0,
    notionalTotal: 0,
    premiumTotal: 0,
    /** Compat previsão legada */
    notionalNear: 0,
  };
}

function addToBucket(map, row, underlying, absNotional, premium, thresholds) {
  const key = underlying;
  if (!map.has(key)) map.set(key, emptyUnderlyingRow(key));
  const st = map.get(key);
  st.notionalTotal += absNotional;
  st.premiumTotal += premium;

  const distPct = optionDistancePct(row);
  const itm = isOptionInTheMoney(row);
  const abs =
    distPct != null && Number.isFinite(distPct) ? Math.abs(distPct) : Infinity;

  if (itm) {
    st.notionalItm += absNotional;
    st.notionalCumPct1 += absNotional;
    st.notionalCumPct2 += absNotional;
  } else if (abs <= thresholds.pct1) {
    st.notionalCumPct1 += absNotional;
    st.notionalCumPct2 += absNotional;
  } else if (abs <= thresholds.pct2) {
    st.notionalCumPct2 += absNotional;
  }

  st.notionalNear = Math.max(0, st.notionalCumPct1 - st.notionalItm);
}

export function processForecastData(
  allRows,
  selectedStrike = 'ALL',
  selectedExpiry = 'ALL',
  thresholds = DEFAULT_PANORAMA_THRESHOLDS
) {
  const shortOptions = allRows.filter((r) => {
    const f = cardFieldRows(r);
    if (f.quantity >= 0) return false;
    if (selectedStrike !== 'ALL' && String(f.strike) !== selectedStrike) return false;
    if (selectedExpiry !== 'ALL' && String(f.expiry) !== selectedExpiry) return false;
    return true;
  });

  const callsMap = new Map();
  const putsMap = new Map();

  for (const row of shortOptions) {
    const f = cardFieldRows(row);
    const underlying = f.underlying;
    const absNotional = Math.abs(f.notional || 0);
    const totalPremium = Math.abs(f.premiumTotal || 0);
    if (f.side === 'call') {
      addToBucket(callsMap, row, underlying, absNotional, totalPremium, thresholds);
    } else if (f.side === 'put') {
      addToBucket(putsMap, row, underlying, absNotional, totalPremium, thresholds);
    }
  }

  const calls = Array.from(callsMap.values()).sort((a, b) =>
    a.underlying.localeCompare(b.underlying)
  );
  const puts = Array.from(putsMap.values()).sort((a, b) =>
    a.underlying.localeCompare(b.underlying)
  );

  return { calls, puts, thresholds };
}

function sumRows(rows, pick) {
  return rows.reduce((s, r) => s + pick(r), 0);
}

/** Totais para panorama: PUTs (cum pct1) negativos; CALLs só ITM positivos. */
export function computePanoramaOptionFlows(allRows, thresholds = DEFAULT_PANORAMA_THRESHOLDS) {
  const { calls, puts } = processForecastData(allRows, 'ALL', 'ALL', thresholds);

  const putsCashNeed = sumRows(puts, (p) => p.notionalCumPct1);
  const callsCashGeneration = sumRows(calls, (c) => c.notionalItm);

  const putsR = Math.round(putsCashNeed * 100) / 100;
  const callsR = Math.round(callsCashGeneration * 100) / 100;

  return {
    putsCashNeed: putsR,
    callsCashGeneration: callsR,
    putsSigned: -putsR,
    callsSigned: callsR,
    netOptionFlow: Math.round((callsR - putsR) * 100) / 100,
    calls,
    puts,
    thresholds,
  };
}

function isCdbTicker(ticker) {
  return String(ticker || '').toUpperCase().startsWith('CDB-');
}

/** Caixa (extrato), renda fixa (Tesouro/LFT) e CDB separados. */
export function sumCapitalBuckets(portfolioItems, cashStatementBalance = 0) {
  const open = filterOpenPortfolioItems(portfolioItems || []);
  const { cash, fixedIncome } = splitPortfolioBySheet(open);

  let rendaFixa = 0;
  let cdb = 0;
  for (const item of fixedIncome) {
    const mv = Number(item.marketValue) || 0;
    if (isCdbTicker(item.ticker)) cdb += mv;
    else rendaFixa += mv;
  }

  let cashCustody = 0;
  for (const item of cash) {
    cashCustody += Number(item.marketValue) || 0;
  }

  const caixaExtrato = Number(cashStatementBalance) || 0;
  const caixa = caixaExtrato > 0 ? caixaExtrato : cashCustody;

  rendaFixa = Math.round(rendaFixa * 100) / 100;
  cdb = Math.round(cdb * 100) / 100;
  const caixaR = Math.round(caixa * 100) / 100;
  const totalLiquido = Math.round((caixaR + rendaFixa + cdb) * 100) / 100;

  return { caixa: caixaR, rendaFixa, cdb, totalLiquido, cashCustody };
}

export function buildPanoramaDecisionModel(
  allRows,
  portfolioItems,
  cashStatementBalance,
  thresholds = DEFAULT_PANORAMA_THRESHOLDS
) {
  const capital = sumCapitalBuckets(portfolioItems, cashStatementBalance);
  const options = computePanoramaOptionFlows(allRows, thresholds);
  const posicaoLiquida = Math.round(
    (capital.totalLiquido + options.netOptionFlow) * 100
  ) / 100;

  return { capital, options, posicaoLiquida, thresholds };
}

/** Rótulos de coluna conforme lado (CALL = acima do spot; PUT = abaixo). */
export function bandColumnLabels(side, thresholds) {
  const p1 = thresholds.pct1;
  const p2 = thresholds.pct2;
  if (side === 'put') {
    return {
      itm: 'Já ITM / ATM',
      cumPct1: `Até ~${p1}% abaixo`,
      cumPct2: `Até ~${p2}% abaixo`,
      total: 'Notional total',
    };
  }
  return {
    itm: 'Já ITM / ATM',
    cumPct1: `Até ~${p1}% acima`,
    cumPct2: `Até ~${p2}% acima`,
    total: 'Notional total',
  };
}
