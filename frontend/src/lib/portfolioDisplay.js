import {
  clearCoCeoExcelMounts,
  mountCoCeoExcelGrids,
  registerCoCeoExcelMount,
} from './coCeoExcelGrid.js';

const FILTER_KEY = 'invest.portfolio.underlying';
const QTY_ZERO_EPS = 1e-9;

const OPTION_TYPES = new Set(['option_call', 'option_put']);

const ASSET_TYPE_LABELS = {
  stock: 'Ação',
  fii: 'FII',
  fixed_income: 'Renda fixa',
  option_call: 'Call',
  option_put: 'Put',
  alternative: 'Alternativo',
  artwork: 'Obra de arte',
  real_estate: 'Imóvel',
  cash: 'Conta corrente invest.',
};

export function getUnderlyingFilter() {
  return sessionStorage.getItem(FILTER_KEY) || '';
}

export function setUnderlyingFilter(value) {
  if (!value) sessionStorage.removeItem(FILTER_KEY);
  else sessionStorage.setItem(FILTER_KEY, value);
}

export function isOptionItem(item) {
  return OPTION_TYPES.has(item.assetType);
}

function isOptionTickerPattern(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (t.includes('-') || t.length < 6) return false;
  const letter = t.charAt(4);
  if (letter < 'A' || letter > 'X') return false;
  return /^[A-Z]{4}[A-X]\d/.test(t);
}

function isOptionLike(item) {
  return isOptionItem(item) || isOptionTickerPattern(item.ticker);
}

/** Opção com quantidade (e valor) zerados — não entra no portfólio aberto. */
export function isZeroOpenOption(item) {
  if (!isOptionLike(item)) return false;
  if (Math.abs(item.quantity) < QTY_ZERO_EPS) return true;
  if (Math.abs(item.marketValue) < 0.01 && Math.abs(item.quantity) < 1e-6) return true;
  return false;
}

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Opções abertas com data de vencimento estritamente após hoje. */
export function filterOptionsVencimentoAfterToday(items) {
  const today = todayIsoLocal();
  return filterOpenPortfolioItems(items).filter((item) => {
    if (!isOptionLike(item)) return false;
    const exp = String(item.optionExpiryDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return true;
    return exp > today;
  });
}

/** Opção com vencimento anterior a hoje — não aparece na tabela de opções abertas. */
export function isExpiredOption(item) {
  if (!isOptionLike(item)) return false;
  const raw = item.optionExpiryDate;
  if (!raw || String(raw).startsWith('0000')) return false;
  const expiry = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false;
  return expiry < todayIsoLocal();
}

/** Só renda fixa (Tesouro, CDB, LFT) com qty ≤ 0 — ações/FIIs/opções podem ser vendidas a descoberto. */
export function isInvalidOpenCustodyPosition(item) {
  const t = String(item.ticker || '').toUpperCase();
  const isFi = item.assetType === 'fixed_income' || isFixedIncomeTicker(t);
  if (!isFi) return false;
  return Number(item.quantity) <= QTY_ZERO_EPS;
}

/** Remove opções encerradas, vencidas e posições inválidas da custódia aberta. */
export function filterOpenPortfolioItems(items) {
  return (items || []).filter(
    (item) =>
      !isZeroOpenOption(item) &&
      !isExpiredOption(item) &&
      !isInvalidOpenCustodyPosition(item)
  );
}

function isFixedIncomeTicker(ticker) {
  const t = String(ticker || '').toUpperCase();
  return (
    t.startsWith('TESOURO-') ||
    t.startsWith('CDB-') ||
    t.startsWith('LFT-') ||
    t.startsWith('TD-')
  );
}

import { formatDateBr } from './dateFormat.js';
import {
  attachCallCoverageToEquities,
  buildShortCallPremiumPendingByUnderlying,
  buildShortCallsSoldByUnderlying,
  collectCallCoverageOptionRows,
  equityCallCoverageCapacity,
  formatOptionTypeLabel,
  optionQtyAbs,
  resolveOptionSide,
  sumShortCallQtyAbs,
} from '../../../src/core/invest/callCoverage.ts';

export {
  attachCallCoverageToEquities,
  buildShortCallPremiumPendingByUnderlying,
  buildShortCallsSoldByUnderlying,
  collectCallCoverageOptionRows,
  equityCallCoverageCapacity,
  formatOptionTypeLabel,
  optionQtyAbs,
  resolveOptionSide,
  sumShortCallQtyAbs,
};

function sheetBucketForItem(item) {
  const t = String(item.ticker || '').toUpperCase();
  if (isOptionLike(item)) return 'options';
  if (item.assetType === 'fixed_income' || isFixedIncomeTicker(t)) return 'fixedIncome';
  if (item.assetType === 'cash' || t.startsWith('CAIXA-')) return 'cash';
  return 'equities';
}

/** Separa custódia em 4 planilhas: ações/FIIs, opções, renda fixa e caixa. */
export function splitPortfolioBySheet(items) {
  const equities = [];
  const options = [];
  const fixedIncome = [];
  const cash = [];
  for (const item of items || []) {
    if (isZeroOpenOption(item)) continue;
    if (isInvalidOpenCustodyPosition(item)) continue;
    const bucket = sheetBucketForItem(item);
    if (bucket === 'options') options.push(item);
    else if (bucket === 'fixedIncome') fixedIncome.push(item);
    else if (bucket === 'cash') cash.push(item);
    else equities.push(item);
  }
  return { equities, options, fixedIncome, cash };
}

/** @deprecated Use splitPortfolioBySheet */
export function splitPortfolioItems(items) {
  const { equities, options } = splitPortfolioBySheet(items);
  return { assets: equities, options };
}

export function collectUnderlyingChoices(items) {
  const open = filterOpenPortfolioItems(items);
  const set = new Set();
  for (const item of open) {
    if (item.underlying) set.add(item.underlying);
    const isEquity =
      item.assetType === 'stock' ||
      item.assetType === 'fii' ||
      (!isOptionLike(item) && item.assetType !== 'fixed_income' && item.assetType !== 'cash');
    if (isEquity && item.ticker) set.add(item.ticker);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Filtra por ação base: mantém o papel e todas as opções ligadas a ele. */
export function filterByUnderlying(items, underlying) {
  if (!underlying) return items || [];
  const u = underlying.toUpperCase();
  return (items || []).filter((item) => {
    const base = (item.underlying || item.ticker || '').toUpperCase();
    return base === u || item.ticker.toUpperCase() === u;
  });
}

export function formatBrl(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function assetTypeLabel(type) {
  return ASSET_TYPE_LABELS[type] || type || '—';
}

export function pnlClass(pnl) {
  if (pnl > 0) return 'portfolio-pnl--up';
  if (pnl < 0) return 'portfolio-pnl--down';
  return '';
}

function qtyDigits(assetType) {
  return assetType === 'fixed_income' ? 0 : 0;
}

function hasDistinctAssetName(item) {
  const name = (item.name || '').trim();
  const ticker = String(item.ticker || '').trim();
  return name.length > 0 && name.toUpperCase() !== ticker.toUpperCase();
}

function formatOptionExpiryLabel(item) {
  if (!isOptionLike(item)) return '—';
  const br = formatDateBr(item.optionExpiryDate);
  if (br !== '—') return br;
  if (!item.optionMonthName) return '—';
  const year = item.optionExpiryDate ? String(item.optionExpiryDate).slice(0, 4) : '';
  const letter = item.optionMonthLetter ? ` (${item.optionMonthLetter})` : '';
  return year ? `${item.optionMonthName}/${year.slice(2)}${letter}` : `${item.optionMonthName}${letter}`;
}

function renderPriceCell(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = '—';
    return span;
  }
  const span = document.createElement('span');
  span.textContent = formatBrl(n);
  return span;
}

function emptyFooterCells(columns) {
  const cells = {};
  for (const col of columns || []) cells[col.key] = '';
  return cells;
}

function sumPortfolioTotals(list) {
  const totalValue = list.reduce((s, r) => s + Number(r.marketValue ?? 0), 0);
  const totalPnl = list.reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  const totalCost = list.reduce((s, r) => s + Number(r.costBasis ?? 0), 0);
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  return { totalValue, totalPnl, totalPct };
}

/** Totais alinhados às colunas (ações/FIIs e planilhas genéricas). */
export function buildCustodyTableFooterColumnTotals(rows) {
  return ({ formatCurrency, currentData, columns }) => {
    const list = currentData?.length ? currentData : rows || [];
    const { totalValue, totalPnl, totalPct } = sumPortfolioTotals(list);
    const pctSign = totalPct >= 0 ? '+' : '';
    const pctCls = totalPnl >= 0 ? 'portfolio-pnl--up' : 'portfolio-pnl--down';
    const cells = emptyFooterCells(columns);
    if ('marketValue' in cells) {
      cells.marketValue = `<span class="portfolio-footer-total">${formatCurrency(totalValue)}</span>`;
    }
    if ('pnl' in cells) {
      cells.pnl = `<span class="portfolio-footer-total ${pnlClass(totalPnl)}">${formatCurrency(totalPnl)}</span>`;
    }
    if ('pnlPct' in cells) {
      cells.pnlPct = `<span class="portfolio-footer-total ${pctCls}">${pctSign}${totalPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>`;
    }
    return cells;
  };
}

/** Resultado ações/FIIs: (cotação atual. − PM B3) × quantidade. */
export function equityResultFromB3Quote(row) {
  const pmB3 = Number(row.prices?.b3 ?? row.avgPrice);
  const quote = Number(row.updatedQuote ?? row.lastPrice);
  const qty = Number(row.quantity);
  if (!Number.isFinite(pmB3) || pmB3 <= 0 || !Number.isFinite(quote) || !Number.isFinite(qty)) {
    return Number(row.pnl ?? 0);
  }
  return Math.round((quote - pmB3) * qty * 100) / 100;
}

/** % resultado da opção: (último − preço médio) / preço médio × 100. */
export function optionPriceReturnPct(row) {
  const pm = Number(row.avgPrice);
  const last = Number(row.lastPrice);
  if (!Number.isFinite(pm) || pm <= 0 || !Number.isFinite(last)) return null;
  return ((last - pm) / pm) * 100;
}

function optionPremiumReceived(row) {
  if (row.premiumReceived != null && Number.isFinite(Number(row.premiumReceived))) {
    return Number(row.premiumReceived);
  }
  const qty = Number(row.quantity);
  const pm = Number(row.avgPrice);
  if (qty < 0 && pm > 0) return Math.abs(qty) * pm;
  return 0;
}

/** Strike cadastrado (metadata/import) — não inferir do sufixo do ticker B3. */
function resolveOptionStrike(row) {
  const s = Number(row.optionStrike);
  if (Number.isFinite(s) && s > 0) return s;
  return null;
}

function optionNotional(row) {
  if (row.notional != null && Number.isFinite(Number(row.notional))) {
    return Number(row.notional);
  }
  const strike = resolveOptionStrike(row);
  if (strike == null || strike <= 0) return null;
  return Math.abs(Number(row.quantity)) * strike;
}

/** Posição vendida em risco de exercício (ITM). */
function isShortOptionExerciseRisk(row) {
  if (Number(row.quantity) >= 0) return false;
  const spot = Number(row.underlyingLastPrice);
  const strike = resolveOptionStrike(row);
  if (!Number.isFinite(spot) || strike == null || strike <= 0) return false;
  if (row.optionSide === 'put') return spot < strike;
  return spot > strike;
}

function formatStrikeDistance(row) {
  const brl = row.strikeDistanceBrl;
  const pct = row.strikeDistancePct;
  if (brl == null || pct == null || !Number.isFinite(brl) || !Number.isFinite(pct)) {
    const spot = Number(row.underlyingLastPrice);
    const strike = resolveOptionStrike(row);
    if (!Number.isFinite(spot) || strike == null || strike <= 0) return null;
    const dBrl = Math.round((spot - strike) * 100) / 100;
    const dPct = Math.round(((spot - strike) / strike) * 10000) / 100;
    return { brl: dBrl, pct: dPct };
  }
  return { brl, pct };
}

/** Planilha de opções — colunas dedicadas. */
export function buildInvestOptionsColumns() {
  return [
    {
      key: 'ticker',
      label: 'Ticker opção',
      type: 'text',
      width: '118px',
      sticky: true,
      render: (row) => {
        const span = document.createElement('strong');
        span.textContent = row.ticker || '—';
        return span;
      },
    },
    {
      key: 'underlying',
      label: 'Ação ref.',
      type: 'text',
      width: '88px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = row.underlying || '—';
        return span;
      },
    },
    {
      key: 'optionType',
      label: 'Tipo',
      type: 'text',
      align: 'center',
      width: '64px',
      render: (row) => {
        const side = resolveOptionSide(row);
        const span = document.createElement('span');
        span.textContent = formatOptionTypeLabel(side);
        span.style.fontWeight = '700';
        span.style.fontSize = '11px';
        span.style.letterSpacing = '0.04em';
        if (side === 'call') {
          span.className = 'portfolio-option-type--call';
          span.title = 'CALL — 5ª letra do ticker entre A e L (início do alfabeto B3)';
        } else if (side === 'put') {
          span.className = 'portfolio-option-type--put';
          span.title = 'PUT — 5ª letra do ticker entre M e X (final do alfabeto B3)';
        } else {
          span.className = 'muted';
        }
        return span;
      },
    },
    {
      key: 'cv',
      label: 'C/V',
      type: 'text',
      width: '48px',
      align: 'center',
      render: (row) => {
        const span = document.createElement('span');
        const q = Number(row.quantity);
        span.textContent = q > 0 ? 'C' : q < 0 ? 'V' : '—';
        span.style.fontWeight = '600';
        span.className = q > 0 ? 'portfolio-pnl--up' : q < 0 ? 'portfolio-pnl--down' : 'muted';
        return span;
      },
    },
    {
      key: 'optionExpiryDate',
      label: 'Data Strike',
      type: 'date',
      align: 'right',
      width: '100px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = formatDateBr(row.optionExpiryDate);
        return span;
      },
    },
    {
      key: 'quantity',
      label: 'Qtde',
      type: 'number',
      align: 'right',
      width: '88px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = formatNumber(row.quantity, 0);
        return span;
      },
    },
    { key: 'avgPrice', label: 'Preço médio', type: 'currency', align: 'right', width: '104px' },
    { key: 'lastPrice', label: 'Último', type: 'currency', align: 'right', width: '96px' },
    {
      key: 'premiumReceived',
      label: 'Prêmio recebido',
      type: 'currency',
      align: 'right',
      width: '112px',
      render: (row) => {
        const v = optionPremiumReceived(row);
        return v > 0 ? renderPriceCell(v) : renderPriceCell(null);
      },
    },
    {
      key: 'optionStrike',
      label: 'Strike',
      type: 'currency',
      align: 'right',
      width: '88px',
      render: (row) => {
        const strike = resolveOptionStrike(row);
        return strike != null ? renderPriceCell(strike) : renderPriceCell(null);
      },
    },
    {
      key: 'underlyingLastPrice',
      label: 'Cotação ação',
      type: 'currency',
      align: 'right',
      width: '104px',
      render: (row) => {
        const lp = row.underlyingLastPrice;
        return lp != null && Number(lp) > 0
          ? renderPriceCell(lp)
          : renderPriceCell(null);
      },
    },
    {
      key: 'strikeDistancePct',
      label: 'Dist. strike',
      type: 'text',
      align: 'right',
      width: '116px',
      render: (row) => {
        const dist = formatStrikeDistance(row);
        const span = document.createElement('span');
        if (!dist) {
          span.className = 'muted';
          span.textContent = '—';
          return span;
        }
        const sign = dist.brl >= 0 ? '+' : '';
        const pctSign = dist.pct >= 0 ? '+' : '';
        span.textContent = `${sign}${formatNumber(dist.brl, 2)} (${pctSign}${formatNumber(dist.pct, 1)}%)`;
        if (isShortOptionExerciseRisk(row)) {
          span.className = 'portfolio-option-itm';
          span.title = 'Posição vendida dentro do dinheiro — maior risco de exercício';
        } else {
          span.title = 'Spot − strike (R$ e %). Positivo: ação acima do strike.';
        }
        return span;
      },
    },
    {
      key: 'notional',
      label: 'Notional',
      type: 'currency',
      align: 'right',
      width: '120px',
      render: (row) => {
        const n = optionNotional(row);
        const span = document.createElement('span');
        if (n == null) {
          span.className = 'muted';
          span.textContent = '—';
          return span;
        }
        span.textContent = formatBrl(n);
        span.style.fontWeight = '700';
        span.title = '|Qtde| × strike — exposição máxima se exercida';
        return span;
      },
    },
    {
      key: 'pnl',
      label: 'Resultado (R$)',
      type: 'currency',
      align: 'right',
      width: '112px',
      colorLogic: 'inflow',
    },
    {
      key: 'pnlPct',
      label: '% Resultado',
      type: 'number',
      align: 'right',
      width: '96px',
      render: (row) => {
        const span = document.createElement('span');
        const pct = optionPriceReturnPct(row) ?? row.pnlPct;
        span.className = pnlClass(row.pnl);
        span.style.fontWeight = '600';
        span.textContent = formatPct(pct);
        span.title = '(Último − Preço médio) / Preço médio';
        return span;
      },
    },
    {
      key: 'allocationPct',
      label: '% carteira',
      type: 'number',
      align: 'right',
      width: '88px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent =
          row.allocationPct != null ? `${formatNumber(row.allocationPct, 1)}%` : '—';
        return span;
      },
    },
  ];
}

function optionFooterWeightedReturnPct(list) {
  let weight = 0;
  let weighted = 0;
  for (const row of list) {
    const pm = Number(row.avgPrice);
    const pct = optionPriceReturnPct(row);
    if (pct == null || pm <= 0) continue;
    const w = Math.abs(Number(row.quantity)) * pm;
    weight += w;
    weighted += pct * w;
  }
  return weight > 0 ? weighted / weight : 0;
}

/** Totais alinhados — planilha de opções. */
export function buildOptionsTableFooterColumnTotals(rows) {
  return ({ formatCurrency, currentData, columns }) => {
    const list = currentData?.length ? currentData : rows || [];
    const totalPnl = list.reduce((s, r) => s + Number(r.pnl ?? 0), 0);
    const totalPct = optionFooterWeightedReturnPct(list);
    const totalPremium = list.reduce((s, r) => s + optionPremiumReceived(r), 0);
    const totalNotional = list.reduce((s, r) => s + (optionNotional(r) ?? 0), 0);
    const totalCallSold = sumShortCallQtyAbs(list);
    const pctSign = totalPct >= 0 ? '+' : '';
    const pctCls = totalPnl >= 0 ? 'portfolio-pnl--up' : 'portfolio-pnl--down';
    const cells = emptyFooterCells(columns);
    if ('optionType' in cells && totalCallSold > 0) {
      cells.optionType = `<span class="portfolio-footer-total" title="Soma das quantidades (|qtde|) de CALL vendidas na tabela">Σ ${totalCallSold.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>`;
    }
    if ('premiumReceived' in cells) {
      cells.premiumReceived = `<span class="portfolio-footer-total">${formatCurrency(totalPremium)}</span>`;
    }
    if ('notional' in cells) {
      cells.notional = `<span class="portfolio-footer-total">${formatCurrency(totalNotional)}</span>`;
    }
    if ('pnl' in cells) {
      cells.pnl = `<span class="portfolio-footer-total ${pnlClass(totalPnl)}">${formatCurrency(totalPnl)}</span>`;
    }
    if ('pnlPct' in cells) {
      cells.pnlPct = `<span class="portfolio-footer-total ${pctCls}">${pctSign}${totalPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>`;
    }
    return cells;
  };
}

function resolveFooterColumnTotals(sheetKey, items) {
  if (sheetKey === 'options') return buildOptionsTableFooterColumnTotals(items);
  return buildCustodyTableFooterColumnTotals(items);
}

export function buildInvestPortfolioColumns(showUnderlying, showExpiryColumn, sheetKey = 'equities') {
  if (sheetKey === 'options') {
    return buildInvestOptionsColumns();
  }

  const cols = [
    {
      key: 'ticker',
      label: 'Ativo',
      type: 'text',
      width: '140px',
      sticky: true,
      render: (row) => {
        const el = document.createElement('div');
        el.style.lineHeight = '1.35';
        let html = `<strong>${row.ticker || '—'}</strong>`;
        if (hasDistinctAssetName(row)) {
          html += `<br><span style="font-size:12px;opacity:0.75">${row.name}</span>`;
        }
        if (showUnderlying && isOptionLike(row)) {
          html += `<br><span style="font-size:11px;opacity:0.65">Mãe: ${row.underlying || '—'}</span>`;
        }
        el.innerHTML = html;
        return el;
      },
    },
    {
      key: 'cv',
      label: 'C/V',
      type: 'text',
      width: '48px',
      align: 'center',
      render: (row) => {
        const span = document.createElement('span');
        const q = Number(row.quantity);
        span.textContent = q > 0 ? 'C' : q < 0 ? 'V' : '—';
        span.style.fontWeight = '600';
        span.className = q > 0 ? 'portfolio-pnl--up' : q < 0 ? 'portfolio-pnl--down' : 'muted';
        return span;
      },
    },
    {
      key: 'assetType',
      label: 'Tipo',
      type: 'text',
      width: '100px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = assetTypeLabel(row.assetType);
        return span;
      },
    },
  ];
  if (showExpiryColumn) {
    cols.push({
      key: 'optionExpiryDate',
      label: 'Vencimento',
      type: 'text',
      align: 'right',
      width: '100px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = formatOptionExpiryLabel(row);
        return span;
      },
    });
  }
  cols.push(
    {
      key: 'quantity',
      label: 'Qtd',
      type: 'number',
      align: 'right',
      width: '88px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = formatNumber(row.quantity, qtyDigits(row.assetType));
        return span;
      },
    },
    ...(sheetKey === 'equities'
      ? [
          {
            key: 'priceStrict',
            label: 'Preço estrito',
            type: 'currency',
            align: 'right',
            width: '104px',
            render: (row) => renderPriceCell(row.prices?.strict),
          },
          {
            key: 'priceB3',
            label: 'PM B3',
            type: 'currency',
            align: 'right',
            width: '96px',
            render: (row) => renderPriceCell(row.prices?.b3),
          },
          {
            key: 'priceManagerial',
            label: 'Meu PM',
            type: 'currency',
            align: 'right',
            width: '96px',
            render: (row) =>
              renderPriceCell(row.prices?.managerial ?? row.avgPrice),
          },
          {
            key: 'threePricesObservation',
            label: 'Observação (3 preços)',
            type: 'text',
            width: '280px',
            render: (row) => {
              const v = row.threePricesValidation;
              const span = document.createElement('span');
              if (!v?.observation) {
                span.className = 'muted';
                span.textContent = '—';
                return span;
              }
              span.textContent = v.observation;
              span.style.fontSize = '12px';
              span.style.lineHeight = '1.35';
              span.style.display = 'block';
              span.style.maxWidth = '320px';
              span.style.whiteSpace = 'normal';
              if (v.status === 'error') {
                span.className = 'portfolio-3p-obs--error';
                span.title = v.messages?.join('\n') || v.observation;
              } else if (v.status === 'warn') {
                span.className = 'portfolio-3p-obs--warn';
                span.title = v.messages?.join('\n') || v.observation;
              } else {
                span.className = 'portfolio-3p-obs--ok';
              }
              return span;
            },
          },
        ]
      : [
          {
            key: 'avgPrice',
            label: 'Preço médio',
            type: 'currency',
            align: 'right',
            width: '112px',
          },
        ]),
    { key: 'lastPrice', label: 'Último', type: 'currency', align: 'right', width: '100px' },
    ...(sheetKey === 'equities'
      ? [
          {
            key: 'updatedQuote',
            label: 'Cotação atual.',
            type: 'currency',
            align: 'right',
            width: '108px',
            render: (row) =>
              renderPriceCell(row.updatedQuote ?? row.lastPrice),
          },
        ]
      : []),
    {
      key: 'marketValue',
      label: 'Valor',
      type: 'currency',
      align: 'right',
      width: '112px',
      render:
        sheetKey === 'equities'
          ? (row) => {
              const pmB3 = Number(row.prices?.b3 ?? row.avgPrice);
              const qty = Number(row.quantity);
              const value =
                pmB3 > 0 && Number.isFinite(qty)
                  ? Math.round(pmB3 * qty * 100) / 100
                  : row.marketValue;
              const span = document.createElement('span');
              span.textContent = formatBrl(value);
              span.title = 'PM B3 × quantidade';
              return span;
            }
          : undefined,
    },
    {
      key: 'allocationPct',
      label: '% carteira',
      type: 'number',
      align: 'right',
      width: '96px',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent =
          row.allocationPct != null ? `${formatNumber(row.allocationPct, 1)}%` : '—';
        return span;
      },
    },
    {
      key: 'pnl',
      label: 'Resultado',
      type: 'currency',
      align: 'right',
      width: '112px',
      colorLogic: 'inflow',
      render:
        sheetKey === 'equities'
          ? (row) => {
              const span = document.createElement('span');
              const pnl = equityResultFromB3Quote(row);
              span.textContent = formatBrl(pnl);
              span.className = pnlClass(pnl);
              span.style.fontWeight = '600';
              span.title = '(Cotação atual. − PM B3) × quantidade';
              return span;
            }
          : undefined,
    },
    {
      key: 'pnlPct',
      label: '% Resultado',
      type: 'number',
      align: 'right',
      width: '96px',
      render: (row) => {
        const span = document.createElement('span');
        const pmB3 = Number(row.prices?.b3 ?? row.avgPrice);
        const quote = Number(row.updatedQuote ?? row.lastPrice);
        const pct =
          sheetKey === 'equities' && pmB3 > 0 && Number.isFinite(quote)
            ? ((quote - pmB3) / pmB3) * 100
            : row.pnlPct;
        const pnlForColor =
          sheetKey === 'equities' ? equityResultFromB3Quote(row) : row.pnl;
        span.className = pnlClass(pnlForColor);
        span.style.fontWeight = '600';
        span.textContent = formatPct(pct);
        return span;
      },
    },
  );

  if (sheetKey === 'equities') {
    cols.push(
      {
        key: 'callsSold',
        label: 'CALLs vendidas',
        type: 'number',
        align: 'right',
        width: '108px',
        render: (row) => {
          const span = document.createElement('span');
          if (row.callsSold == null) {
            span.className = 'muted';
            span.textContent = '—';
            return span;
          }
          span.textContent = formatNumber(row.callsSold, 0);
          const prem = Number(row.callsPremiumPending);
          if (prem > 0) {
            span.title = `CALLs vendidas (soma das posições curtas CALL, incl. PRIOF). Prêmio em trânsito (D+1): ${formatBrl(prem)}`;
          } else {
            span.title =
              'CALLs vendidas — soma das posições curtas CALL (planilha Opções + livro-razão)';
          }
          return span;
        },
      },
      {
        key: 'callsPremiumPending',
        label: 'Prêmio CALL (D+1)',
        type: 'currency',
        align: 'right',
        width: '120px',
        render: (row) => {
          const span = document.createElement('span');
          const prem = Number(row.callsPremiumPending);
          if (!Number.isFinite(prem) || prem <= 0) {
            span.className = 'muted';
            span.textContent = '—';
            return span;
          }
          span.textContent = formatBrl(prem);
          span.style.fontWeight = '600';
          span.className = 'portfolio-call-premium-pending';
          span.title = 'Prêmio das CALLs vendidas — crédito previsto na conta investimento (D+1 útil)';
          return span;
        },
      },
      {
        key: 'callsRemaining',
        label: 'CALLs sobrando',
        type: 'number',
        align: 'right',
        width: '112px',
        render: (row) => {
          const span = document.createElement('span');
          if (row.callsRemaining == null) {
            span.className = 'muted';
            span.textContent = '—';
            return span;
          }
          const n = Number(row.callsRemaining);
          span.textContent = formatNumber(n, 0);
          span.style.fontWeight = '600';
          if (n < 0) {
            span.className = 'portfolio-calls-uncovered';
            span.title =
              'Vendido mais CALLs do que ações em custódia — risco de posição descoberta';
          } else {
            span.title = 'Ações em custódia − CALLs vendidas (mesma unidade da corretora)';
          }
          return span;
        },
      }
    );
  }

  return cols;
}

let portfolioTableSeq = 0;

function buildSheetCaption(title, items, sheetKey) {
  if (sheetKey === 'options') {
    return title;
  }
  const n = items.length;
  return `${title} <span class="muted">(${n})</span>`;
}

function renderTableSection(
  title,
  items,
  {
    showUnderlying = false,
    showExpiryColumn = false,
    emptyLabel,
    sheetKey = 'equities',
    allOptions = [],
    coverageOptions = [],
    premiumByUnderlying = null,
  }
) {
  const optsForCoverage = coverageOptions.length ? coverageOptions : allOptions;
  const rows =
    sheetKey === 'equities'
      ? attachCallCoverageToEquities(items, optsForCoverage, premiumByUnderlying)
      : items;
  const mountId = `pft-${++portfolioTableSeq}`;
  registerCoCeoExcelMount(mountId, {
    gridId: `invest-portfolio-${mountId}`,
    coCeoColumns: buildInvestPortfolioColumns(showUnderlying, showExpiryColumn, sheetKey),
    rows,
    emptyText: emptyLabel,
    caption: buildSheetCaption(title, items, sheetKey),
    footerColumnTotals: resolveFooterColumnTotals(sheetKey, items),
    summaryLabels: { total: 'Linhas', selected: '' },
  });
  return `<div class="portfolio-excel-section" data-coceo-excel-mount="${mountId}"></div>`;
}

export function mountPortfolioExcelTables(container) {
  mountCoCeoExcelGrids(container);
}

export function renderPortfolioTable(items) {
  return renderPortfolioExcelTables(items, '');
}

/** Tabela excel para opções zeradas (tela Transações finalizadas). */
export function renderClosedOptionsTable(closedOptions) {
  if (!closedOptions?.length) {
    return '<p class="empty-state">Nenhuma opção finalizada (quantidade zerada).</p>';
  }
  return renderTableSection('Opções finalizadas', closedOptions, {
    showUnderlying: true,
    showExpiryColumn: true,
    emptyLabel: 'Nenhuma opção finalizada.',
    sheetKey: 'options',
  });
}

const EXCEL_SHEETS = [
  {
    key: 'equities',
    title: 'Ações e FIIs',
    showUnderlying: false,
    emptyDefault: 'Nenhuma ação ou FII na custódia.',
    emptyFiltered: 'Nenhuma ação/FII para este filtro.',
  },
  {
    key: 'options',
    title: 'Opções',
    showUnderlying: true,
    showExpiryColumn: true,
    emptyDefault: 'Nenhuma opção aberta na custódia.',
    emptyFiltered: 'Nenhuma opção aberta para este ativo.',
  },
  {
    key: 'fixedIncome',
    title: 'Renda fixa',
    showUnderlying: false,
    emptyDefault: 'Nenhuma posição em renda fixa.',
    emptyFiltered: 'Nenhuma renda fixa para este filtro.',
  },
  {
    key: 'cash',
    title: 'Caixa',
    showUnderlying: false,
    emptyDefault: 'Nenhum saldo em conta corrente investida.',
    emptyFiltered: 'Nenhum caixa para este filtro.',
  },
];

/** Conta corrente + CDB + Tesouro/LFT e demais RF de baixo risco — bloco “dinheiro em caixa”. */
export function collectCashLikeCustodyItems(items) {
  const openItems = filterOpenPortfolioItems(items);
  const { cash, fixedIncome } = splitPortfolioBySheet(openItems);
  return [...cash, ...fixedIncome].sort(
    (a, b) => (Number(b.marketValue) || 0) - (Number(a.marketValue) || 0)
  );
}

/** Patrimônio = ações/FIIs + opções (venc. &gt; hoje) + caixa / baixo risco + trânsito. */
export function computePortfolioPatrimonyFromTables(
  items,
  underlyingFilter = '',
  { cashStatementBalance = 0, cashInTransit = null } = {}
) {
  const openItems = filterOpenPortfolioItems(items);
  const filtered = filterByUnderlying(openItems, underlyingFilter);
  const { equities } = splitPortfolioBySheet(filtered);
  const options = filterOptionsVencimentoAfterToday(filtered);
  const cashLike = collectCashLikeCustodyItems(openItems);
  const equitiesMv = equities.reduce((s, i) => s + (Number(i.marketValue) || 0), 0);
  const optionsMv = options.reduce((s, i) => s + (Number(i.marketValue) || 0), 0);
  const cashPositionsMv = cashLike.reduce((s, i) => s + (Number(i.marketValue) || 0), 0);
  const inTransitNet = Number(cashInTransit?.inTransitNet) || 0;
  const cashMv = Math.round((cashPositionsMv + inTransitNet) * 100) / 100;
  const total = Math.round((equitiesMv + optionsMv + cashMv) * 100) / 100;
  return {
    equitiesMv: Math.round(equitiesMv * 100) / 100,
    optionsMv: Math.round(optionsMv * 100) / 100,
    cashMv,
    cashPositionsMv: Math.round(cashPositionsMv * 100) / 100,
    inTransitNet: Math.round(inTransitNet * 100) / 100,
    total,
    equityCount: equities.length,
    optionsCount: options.length,
    cashLikeCount: cashLike.length,
  };
}

export function renderPortfolioPatrimonyHeader(totals) {
  return `
    <div class="portfolio-patrimony-total card" style="margin-bottom:16px;padding:16px 20px;background:rgba(218,177,119,0.12);border:1px solid rgba(218,177,119,0.35);border-radius:8px">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 24px;margin-bottom:12px">
        <span class="portfolio-kpi-label" style="font-size:13px">Patrimônio total (cliente)</span>
        <strong style="font-size:26px;letter-spacing:-0.02em">${formatBrl(totals.total)}</strong>
      </div>
      <div class="portfolio-kpis" style="margin:0">
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Ações e FIIs (mercado)</span>
          <strong>${formatBrl(totals.equitiesMv)}</strong>
          <span class="portfolio-kpi-sub muted">${totals.equityCount} linha(s)</span>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Opções venc. &gt; hoje (mercado)</span>
          <strong>${formatBrl(totals.optionsMv)}</strong>
          <span class="portfolio-kpi-sub muted">${totals.optionsCount} linha(s)</span>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Caixa e baixo risco</span>
          <strong>${formatBrl(totals.cashMv)}</strong>
          <span class="portfolio-kpi-sub muted">${totals.cashLikeCount} posição(ões) + trânsito</span>
        </div>
      </div>
      <p class="muted" style="margin:12px 0 0;font-size:12px">
        Caixa e baixo risco: conta corrente, CDB, Tesouro e títulos públicos (sem risco de mercado como ações/opções), mais valores em trânsito.
      </p>
    </div>
  `;
}

function renderCashLikePortfolioSection(items, cashStatementBalance, cashInTransit) {
  const cashLike = collectCashLikeCustodyItems(items);
  const positionsMv = cashLike.reduce((s, i) => s + (Number(i.marketValue) || 0), 0);
  const inTransitNet = Number(cashInTransit?.inTransitNet) || 0;

  const custodyTable =
    cashLike.length > 0
      ? renderTableSection('Baixo risco (conta, CDB, Tesouro…)', cashLike, {
          showUnderlying: false,
          emptyLabel: 'Nenhuma posição de caixa ou baixo risco.',
          sheetKey: 'fixedIncome',
          allOptions: [],
          coverageOptions: [],
        })
      : '<p class="muted" style="margin:8px 0 16px">Nenhuma posição de caixa ou baixo risco na custódia.</p>';

  const cashInner = renderCashTransitInner(cashStatementBalance, cashInTransit);

  return `
    <div class="portfolio-cash-block" style="margin-top:20px">
      <h3 style="font-size:15px;margin:0 0 12px">Caixa e baixo risco</h3>
      <p class="muted" style="margin:0 0 12px;font-size:13px">
        Conta corrente, CDB e Tesouro/títulos do governo — aplicações de baixo risco, fora do risco de mercado de ações e opções.
      </p>
      <div class="portfolio-kpis" style="margin-bottom:12px">
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Total posições (mercado)</span>
          <strong>${formatBrl(positionsMv)}</strong>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Em trânsito (líquido)</span>
          <strong class="${inTransitNet >= 0 ? 'is-positive' : 'is-negative'}">${formatBrl(inTransitNet)}</strong>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Subtotal caixa / baixo risco</span>
          <strong>${formatBrl(positionsMv + inTransitNet)}</strong>
        </div>
      </div>
      ${custodyTable}
      ${cashInner}
    </div>
  `;
}

function renderCashTransitInner(cashStatementBalance, cashInTransit) {
  const settled = Number(cashStatementBalance) || 0;
  const transit = cashInTransit || {};
  const inTransitNet = Number(transit.inTransitNet) || 0;
  const receivables = Number(transit.receivables) || 0;
  const payables = Number(transit.payables) || 0;
  const including = Number(transit.cashIncludingTransit) || settled + inTransitNet;
  const lines = Array.isArray(transit.lines) ? transit.lines : [];

  const rowsHtml = lines.length
    ? lines
        .map((ln) => {
          const amt = Number(ln.amount) || 0;
          const cls = amt >= 0 ? 'is-positive' : 'is-negative';
          return `<tr>
            <td>${formatDateBr(ln.tradeDate)}</td>
            <td>${formatDateBr(ln.settleDate)}</td>
            <td>${ln.ticker || '—'}</td>
            <td>${ln.transactionType || '—'}</td>
            <td class="num ${cls}">${formatBrl(amt)}</td>
            <td class="muted">${ln.rule || '—'}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="muted">Nenhum valor em trânsito aberto.</td></tr>';

  return `
    <div class="portfolio-cash-transit-inner">
      <h4 style="font-size:14px;margin:16px 0 10px;font-weight:600">Conta corrente e trânsito</h4>
      <div class="portfolio-kpis" style="margin-bottom:12px">
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Saldo em caixa (liquidado)</span>
          <strong>${formatBrl(settled)}</strong>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Em trânsito (líquido)</span>
          <strong class="${inTransitNet >= 0 ? 'is-positive' : 'is-negative'}">${formatBrl(inTransitNet)}</strong>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">A receber</span>
          <strong>${formatBrl(receivables)}</strong>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">A pagar</span>
          <strong>${formatBrl(Math.abs(payables))}</strong>
        </div>
        <div class="portfolio-kpi">
          <span class="portfolio-kpi-label">Caixa + trânsito</span>
          <strong>${formatBrl(including)}</strong>
        </div>
      </div>
      <div class="table-wrapper" style="max-height:280px;overflow:auto">
        <table class="portfolio-cash-table" style="width:100%;font-size:13px;border-collapse:collapse">
          <thead>
            <tr>
              <th>Data neg.</th>
              <th>Liquidação</th>
              <th>Ativo</th>
              <th>Tipo</th>
              <th class="num">Valor</th>
              <th>Regra</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderInvestPortfolioPage(
  items,
  underlyingFilter = '',
  { cashStatementBalance = 0, cashInTransit = null } = {}
) {
  clearCoCeoExcelMounts();
  portfolioTableSeq = 0;
  const openItems = filterOpenPortfolioItems(items);
  const filtered = filterByUnderlying(openItems, underlyingFilter);
  const { equities } = splitPortfolioBySheet(filtered);
  const coverageOptions = collectCallCoverageOptionRows(openItems, null);

  const filterNote = underlyingFilter
    ? `<p class="portfolio-filter-active muted">Filtro: <strong>${underlyingFilter}</strong></p>`
    : '';

  const equitySection = renderTableSection('Ações e FIIs', equities, {
    showUnderlying: false,
    emptyLabel: underlyingFilter
      ? 'Nenhuma ação/FII para este filtro.'
      : 'Nenhuma ação ou FII na custódia.',
    sheetKey: 'equities',
    allOptions: [],
    coverageOptions,
  });

  return `${filterNote}${equitySection}`;
}

export function renderInvestOpcoesPage(
  items,
  underlyingFilter = ''
) {
  clearCoCeoExcelMounts();
  portfolioTableSeq = 0;
  const openItems = filterOpenPortfolioItems(items);
  const filtered = filterByUnderlying(openItems, underlyingFilter);
  const options = filterOptionsVencimentoAfterToday(filtered);
  const coverageOptions = collectCallCoverageOptionRows(openItems, null);

  const filterNote = underlyingFilter
    ? `<p class="portfolio-filter-active muted">Filtro: <strong>${underlyingFilter}</strong></p>`
    : '';

  const optionsSection = renderTableSection('Opções Vigentes', options, {
    showUnderlying: true,
    showExpiryColumn: true,
    emptyLabel: underlyingFilter
      ? 'Nenhuma opção vigente para este filtro.'
      : 'Nenhuma opção vigente (vencimento após hoje).',
    sheetKey: 'options',
    allOptions: options,
    coverageOptions,
  });

  return `${filterNote}${optionsSection}`;
}

export function renderInvestTitulosPage(
  items,
  { cashStatementBalance = 0, cashInTransit = null } = {}
) {
  clearCoCeoExcelMounts();
  portfolioTableSeq = 0;

  const cashSection = renderCashLikePortfolioSection(
    items,
    cashStatementBalance,
    cashInTransit
  );

  return cashSection;
}

/** Somente ações e FIIs em custódia aberta (legado). */
export function renderEquityPortfolioTable(items, underlyingFilter = '') {
  clearCoCeoExcelMounts();
  portfolioTableSeq = 0;
  const openItems = filterOpenPortfolioItems(items);
  const filtered = filterByUnderlying(openItems, underlyingFilter);
  const { equities } = splitPortfolioBySheet(filtered);
  const coverageOptions = collectCallCoverageOptionRows(openItems, null);

  if (!equities.length) {
    return '<p class="empty-state">Nenhuma ação ou FII na custódia aberta.</p>';
  }

  const filterNote = underlyingFilter
    ? `<p class="portfolio-filter-active muted">Filtro: <strong>${underlyingFilter}</strong></p>`
    : '';

  return `${filterNote}${renderTableSection('Ações e FIIs', equities, {
    showUnderlying: false,
    emptyLabel: underlyingFilter
      ? 'Nenhuma ação/FII para este filtro.'
      : 'Nenhuma ação ou FII na custódia.',
    sheetKey: 'equities',
    allOptions: [],
    coverageOptions,
  })}`;
}

export function renderPortfolioExcelTables(items, underlyingFilter = '') {
  clearCoCeoExcelMounts();
  portfolioTableSeq = 0;
  const openItems = filterOpenPortfolioItems(items);
  const filtered = filterByUnderlying(openItems, underlyingFilter);
  const sheets = splitPortfolioBySheet(filtered);
  const filterNote = underlyingFilter
    ? `<p class="portfolio-filter-active muted">Filtro: <strong>${underlyingFilter}</strong> — ações/FIIs e opções vinculadas nas tabelas abaixo.</p>`
    : '';

  if (!openItems.length) {
    return '<p class="empty-state">Nenhuma posição aberta na custódia.</p>';
  }

  const coverageOptions = collectCallCoverageOptionRows(openItems, null);
  const sections = EXCEL_SHEETS.map((cfg) =>
    renderTableSection(cfg.title, sheets[cfg.key], {
      showUnderlying: cfg.showUnderlying,
      showExpiryColumn: Boolean(cfg.showExpiryColumn),
      emptyLabel: underlyingFilter ? cfg.emptyFiltered : cfg.emptyDefault,
      sheetKey: cfg.key,
      allOptions: sheets.options,
      coverageOptions,
    })
  ).join('');

  return `${filterNote}${sections}`;
}

export function renderUnderlyingFilterSelect(items, selected = '') {
  const choices = collectUnderlyingChoices(items);
  const opts = [
    '<option value="">Todos os ativos</option>',
    ...choices.map(
      (t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`
    ),
  ].join('');
  return `
    <label class="portfolio-filter-label">
      Ação base
      <select id="portfolio-underlying-filter" class="portfolio-filter-select">${opts}</select>
    </label>
  `;
}

function formatTwrPct(twr) {
  if (twr == null || Number.isNaN(twr)) return '—';
  const pct = twr * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** KPIs da custódia; `performance` = mesmo TWR do patrimônio diário (aportes/retiradas ajustados). */
export function renderPortfolioSummary(summary, performance) {
  if (!summary) return '';
  const pnlCls = pnlClass(summary.totalPnl);
  const fundKpi =
    performance && performance.periodReturnTwr != null
      ? `
      <div class="portfolio-kpi">
        <span class="portfolio-kpi-label">Rentab. carteira (TWR)</span>
        <strong class="${performance.periodGainBrl >= 0 ? 'is-positive' : 'is-negative'}">
          ${formatTwrPct(performance.periodReturnTwr)}
          <span class="portfolio-kpi-sub">(${formatBrl(performance.periodGainBrl)} no período)</span>
        </strong>
      </div>`
      : '';
  return `
    <div class="portfolio-kpis">
      <div class="portfolio-kpi">
        <span class="portfolio-kpi-label">Patrimônio (mercado)</span>
        <strong>${formatBrl(summary.totalMarketValue)}</strong>
      </div>
      <div class="portfolio-kpi">
        <span class="portfolio-kpi-label">Posições</span>
        <strong>${summary.positionCount}</strong>
      </div>
      <div class="portfolio-kpi">
        <span class="portfolio-kpi-label">Resultado não realizado</span>
        <strong class="${pnlCls}">${formatBrl(summary.totalPnl)} <span class="portfolio-kpi-sub">(${formatPct(summary.totalPnlPct)})</span></strong>
      </div>
      ${fundKpi}
    </div>
  `;
}
