/**
 * Bloco "Liquidez e síntese" — caixa liquidado (extrato), RF/CDB e efeito de opções vendidas.
 */
import { buildExposureByUnderlying } from './optionExposureTables.js';
import { filterOptionsRows } from './optionPortfolioModel.js';
import { resolveOptionSide, splitPortfolioBySheet } from './portfolioDisplay.js';

function isTesouroTicker(ticker) {
  const t = String(ticker || '').toUpperCase();
  return t.startsWith('LFT-') || t.startsWith('TESOURO-') || t.includes('SELIC');
}

function isCdbTicker(ticker) {
  return String(ticker || '').toUpperCase().startsWith('CDB');
}

function sumMarketValue(items) {
  return Math.round(
    (items || []).reduce((s, i) => s + (Number(i.marketValue) || 0), 0) * 100
  ) / 100;
}

/** PUTs ITM + faixa próxima (cumulativo); CALLs só ITM (1º nível). */
export function buildOptionsLiquidityEffect(optionRows, pctNear = 5) {
  const shorts = (optionRows || []).filter((r) => Number(r.quantity) < 0);
  const puts = buildExposureByUnderlying(shorts, 'put', pctNear, pctNear + 5);
  const calls = buildExposureByUnderlying(shorts, 'call', pctNear, pctNear + 5);

  const putsCashNeed = Math.round((puts.totals.itm + puts.totals.bandNear) * 100) / 100;
  const callsCashGen = Math.round(calls.totals.itm * 100) / 100;
  const net = Math.round((callsCashGen - putsCashNeed) * 100) / 100;

  return {
    putsCashNeed,
    callsCashGen,
    net,
  };
}

export function buildLiquiditySynthesis({
  portfolioItems = [],
  cashStatementBalance = 0,
  optionRows = [],
  pctNear = 5,
}) {
  const { fixedIncome } = splitPortfolioBySheet(portfolioItems);
  const tesouro = fixedIncome.filter((i) => isTesouroTicker(i.ticker));
  const cdb = fixedIncome.filter((i) => isCdbTicker(i.ticker));
  const tesouroMv = sumMarketValue(tesouro);
  const cdbMv = sumMarketValue(cdb);
  const cashSettled = Math.round(Number(cashStatementBalance) * 100) / 100;
  const liquiditySubtotal = Math.round((cashSettled + tesouroMv + cdbMv) * 100) / 100;

  const openOptions = filterOptionsRows(optionRows, {});
  const optionsFx = buildOptionsLiquidityEffect(openOptions, pctNear);

  return {
    cashSettled,
    tesouroMv,
    cdbMv,
    liquiditySubtotal,
    putsCashNeed: optionsFx.putsCashNeed,
    callsCashGen: optionsFx.callsCashGen,
    optionsNet: optionsFx.net,
  };
}
