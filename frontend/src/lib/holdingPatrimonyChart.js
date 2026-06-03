import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { formatDateBr } from './dateFormat.js';
import { formatBrl } from './portfolioDisplay.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
);

let activeChart = null;

function formatPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** Índice 100 no primeiro ponto = 0% de rentabilidade no período. */
function toIndexedFromFirst(values, baseLevel = 100) {
  const first = Number(values[0]);
  if (!Number.isFinite(first) || first <= 0) {
    return values.map(() => baseLevel);
  }
  return values.map((v) =>
    Math.round((Number(v) / first) * baseLevel * 1_000_000) / 1_000_000
  );
}

/** Garante que o primeiro valor não-nulo do array seja exatamente 100. */
function rebaseIndexedSeries(values) {
  const firstIdx = values.findIndex((v) => v != null && Number.isFinite(Number(v)));
  if (firstIdx < 0) return values;
  const base = Number(values[firstIdx]);
  if (!base || base <= 0) return values;
  return values.map((v) =>
    v == null || !Number.isFinite(Number(v))
      ? null
      : Math.round((Number(v) / base) * 100 * 1_000_000) / 1_000_000
  );
}

function indexedToPct(indexLevel) {
  if (indexLevel == null || !Number.isFinite(Number(indexLevel))) return null;
  return (Number(indexLevel) / 100 - 1) * 100;
}

function visibleAxisBounds(chart) {
  const values = [];
  chart.data.datasets.forEach((dataset, index) => {
    if (!chart.isDatasetVisible(index)) return;
    (dataset.data || []).forEach((v) => {
      const n = Number(v);
      if (Number.isFinite(n)) values.push(n);
    });
  });
  if (!values.length) return { min: 97, max: 103 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const padding = Math.max(2, spread * 0.08);
  return {
    min: Math.floor((min - padding) * 10) / 10,
    max: Math.ceil((max + padding) * 10) / 10,
  };
}

function applyVisibleAxisBounds(chart) {
  const bounds = visibleAxisBounds(chart);
  chart.options.scales.yIndex.min = bounds.min;
  chart.options.scales.yIndex.max = bounds.max;
}

function isoDate(value) {
  return String(value ?? '').slice(0, 10);
}

function indexSeriesHasVariation(values) {
  const nums = values
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map((v) => Number(v));
  if (nums.length < 2) return false;
  return Math.max(...nums) - Math.min(...nums) > 0.05;
}

/**
 * Curva da carteira no gráfico: API (portfolioIndexed) → performance.points → patrimônio.
 * Evita linha invisível quando TWR gravado veio plano mas o resumo já mostra rentabilidade.
 */
export function buildPortfolioIndexValues(labels, patrimonyBrl, portfolioChartSeries, performance) {
  const fromApiMap = new Map(
    (portfolioChartSeries || []).map((p) => [isoDate(p.date), Number(p.indexedLevel)])
  );

  if (fromApiMap.size) {
    const aligned = labels.map((d) => {
      const v = fromApiMap.get(isoDate(d));
      return v != null && Number.isFinite(v) ? v : null;
    });
    const rebased = rebaseIndexedSeries(aligned);
    if (indexSeriesHasVariation(rebased)) return rebased;
  }

  const points = performance?.points;
  if (points?.length) {
    const perfMap = new Map(
      points.map((p) => [isoDate(p.date), Number(p.cumulativeReturnTwr ?? 0)])
    );
    const fromPerf = rebaseIndexedSeries(
      labels.map((d) => {
        const key = isoDate(d);
        if (!perfMap.has(key)) return null;
        const twr = perfMap.get(key) ?? 0;
        return Math.round(100 * (1 + twr) * 1_000_000) / 1_000_000;
      })
    );
    if (indexSeriesHasVariation(fromPerf)) return fromPerf;
  }

  return rebaseIndexedSeries(toIndexedFromFirst(patrimonyBrl));
}

function renderCashTransitBlock(cashInTransit) {
  if (!cashInTransit) return '';
  return `<div class="holding-summary-side muted" style="margin-top:8px;text-align:left">
    <span>Conta corrente: <strong>${formatBrl(cashInTransit.settledCashBalance)}</strong></span>
    <span>Em trânsito: <strong>${formatBrl(cashInTransit.inTransitNet)}</strong>
      (receber ${formatBrl(cashInTransit.receivables)} · pagar ${formatBrl(Math.abs(cashInTransit.payables || 0))})</span>
  </div>`;
}

export function renderHoldingPatrimonySummary(
  series,
  performance,
  btgReference,
  cashInTransit,
  cdiComparison,
  stockBenchmark
) {
  const today = new Date().toISOString().slice(0, 10);
  const clipped = (series || []).filter((p) => String(p.date).slice(0, 10) <= today);
  if (!clipped.length) {
    return '<p class="muted">Sem dados no período.</p>';
  }
  const first = clipped[0];
  const last = clipped[clipped.length - 1];

  if (performance) {
    const gain = performance.periodGainBrl;
    const twr = performance.periodReturnTwr;
    const positive = gain >= 0;
    const flowsNote =
      performance.externalFlows?.length > 0
        ? `${performance.externalFlows.length} fluxo(s) externo(s) ajustado(s)`
        : 'sem aportes/retiradas no período';
    const btgLine =
      btgReference && btgReference.btgPublishedTwr != null
        ? `<span class="muted" style="font-size:12px;display:block;margin-top:6px">
            BTG (tabela mensal): <strong>${formatPct(btgReference.btgPublishedTwr)}</strong>
            · sistema: ${formatPct(twr)}
            · diferença: ${btgReference.gapPctPoints >= 0 ? '+' : ''}${btgReference.gapPctPoints.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} p.p.
          </span>`
        : '';
    const anchorLine =
      performance.monthAnchorTwr != null
        ? `<span class="muted" style="font-size:12px;display:block;margin-top:2px">
            TWR por fechamentos mensais (âncoras): ${formatPct(performance.monthAnchorTwr)}
          </span>`
        : '';
    const cdiLine =
      cdiComparison && cdiComparison.cdiPeriodReturn != null
        ? `<span class="muted" style="font-size:12px;display:block;margin-top:4px">
            CDI no período: <strong>${formatPct(cdiComparison.cdiPeriodReturn)}</strong>
            · Carteira (índice): ${formatPct(cdiComparison.portfolioPeriodReturn)}
            · vs CDI: <strong class="${cdiComparison.excessReturn >= 0 ? 'is-positive' : 'is-negative'}">${cdiComparison.excessReturn >= 0 ? '+' : ''}${formatPct(cdiComparison.excessReturn)}</strong>
          </span>`
        : '';
    return `
    <div class="holding-summary">
      <div class="holding-summary-main">
        <span class="holding-summary-label">Patrimônio líquido (holding)</span>
        <strong class="holding-summary-value">${formatBrl(last.patrimony)}</strong>
        <span class="holding-summary-change ${positive ? 'is-positive' : 'is-negative'}">
          Ganho ${positive ? '+' : ''}${formatBrl(gain)} · rentab. ${formatPct(twr)} (TWR)
        </span>
        ${btgLine}
      </div>
      <div class="holding-summary-side muted">
        <span>${formatDateBr(first.date)} → ${formatDateBr(last.date)}</span>
        <span>${series.length} dias</span>
      </div>
    </div>
  `;
  }

  const change = last.patrimony - first.patrimony;
  const pct = first.patrimony > 0 ? change / first.patrimony : 0;
  const positive = change >= 0;

  return `
    <div class="holding-summary">
      <div class="holding-summary-main">
        <span class="holding-summary-label">Patrimônio líquido (holding)</span>
        <strong class="holding-summary-value">${formatBrl(last.patrimony)}</strong>
        <span class="holding-summary-change ${positive ? 'is-positive' : 'is-negative'}">
          ${positive ? '+' : ''}${formatBrl(change)} (${formatPct(pct)}) no período
        </span>
      </div>
      <div class="holding-summary-side muted">
        <span>${formatDateBr(first.date)} → ${formatDateBr(last.date)}</span>
        <span>${clipped.length} dias · calibrado BTG</span>
        ${renderCashTransitBlock(cashInTransit)}
      </div>
    </div>
  `;
}

/**
 * Gráfico diário da holding (estilo invest_dashboard.html, dados reais da API).
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{ date: string, patrimony: number }>} series
 */
/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{ date: string, patrimony: number }>} series
 * @param {{
 *   datasetLabel?: string,
 *   cdiBenchmark?: { available?: boolean, series?: Array<{ date: string, indexedLevel: number }> },
 *   stockBenchmark?: { available?: boolean, ticker?: string, series?: Array<{ date: string, indexedLevel: number }> },
 *   portfolioChartSeries?: Array<{ date: string, indexedLevel: number, periodReturnToDate?: number }> (TWR diário),
 * }} [opts]
 */
export function mountHoldingPatrimonyChart(canvas, series, opts = {}) {
  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const clipped = (series || []).filter((p) => String(p.date).slice(0, 10) <= today);

  if (!clipped.length) {
    return { empty: true };
  }

  const labels = clipped.map((p) => p.date);
  const patrimonyBrl = clipped.map((p) => Number(p.patrimony));
  const portfolioIndexed = buildPortfolioIndexValues(
    labels,
    patrimonyBrl,
    opts.portfolioChartSeries,
    opts.performance
  );
  const tickSet = new Set(sampleLabels(clipped));

  const gold = '#DAB177';
  const goldFill = 'rgba(218, 177, 119, 0.12)';
  const white = '#FFFFFF';
  const cdiByDate = new Map(
    (opts.cdiBenchmark?.series || []).map((p) => [String(p.date).slice(0, 10), Number(p.indexedLevel)])
  );
  const stockTicker = String(opts.stockBenchmark?.ticker || '').toUpperCase();
  const stockByDate = new Map(
    (opts.stockBenchmark?.series || []).map((p) => [
      String(p.date).slice(0, 10),
      Number(p.indexedLevel),
    ])
  );
  const hasCdi = opts.cdiBenchmark?.available && cdiByDate.size > 0;
  const hasStock = opts.stockBenchmark?.available && stockByDate.size > 0;
  const cdiValues = rebaseIndexedSeries(
    labels.map((d) => (cdiByDate.has(d) ? cdiByDate.get(d) : null))
  );
  const stockValues = rebaseIndexedSeries(
    labels.map((d) => (stockByDate.has(d) ? stockByDate.get(d) : null))
  );
  const stockOrange = '#FB923C';

  const portfolioLabel = opts.datasetLabel
    ? `${opts.datasetLabel} (TWR %)`
    : 'Carteira (TWR %)';

  /** @type {import('chart.js').ChartDataset[]} */
  /** @type {import('chart.js').ChartDataset[]} */
  const datasets = [];

  if (hasCdi) {
    datasets.push({
      label: 'CDI (%)',
      data: cdiValues,
      borderColor: white,
      borderWidth: 2,
      borderDash: [6, 4],
      tension: 0.15,
      fill: false,
      pointRadius: 0,
      pointHitRadius: 8,
      pointHoverRadius: 3,
      yAxisID: 'yIndex',
      order: 1,
    });
  }

  if (hasStock) {
    datasets.push({
      label: `${stockTicker} buy & hold (%)`,
      data: stockValues,
      borderColor: stockOrange,
      borderWidth: 2,
      borderDash: [4, 3],
      tension: 0.2,
      fill: false,
      pointRadius: 0,
      pointHitRadius: 8,
      pointHoverRadius: 3,
      yAxisID: 'yIndex',
      order: 2,
    });
  }

  datasets.push({
    label: portfolioLabel,
    data: portfolioIndexed,
    borderColor: gold,
    backgroundColor: goldFill,
    borderWidth: 3,
    tension: 0.35,
    fill: true,
    spanGaps: true,
    pointRadius: 0,
    pointHitRadius: 8,
    pointHoverRadius: 4,
    yAxisID: 'yIndex',
    order: 10,
  });

  const wrap = canvas.parentElement;
  if (wrap) {
    wrap.style.width = '100%';
    wrap.style.maxWidth = '100%';
  }

  activeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94A3B8', boxWidth: 12, padding: 16 },
          onClick(_evt, legendItem, legend) {
            const chart = legend.chart;
            const index = legendItem.datasetIndex;
            if (index == null) return;
            const visible = chart.isDatasetVisible(index);
            chart.setDatasetVisibility(index, !visible);
            applyVisibleAxisBounds(chart);
            chart.update();
          },
        },
        tooltip: {
          backgroundColor: '#0A1D30',
          titleColor: gold,
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          callbacks: {
            title(items) {
              const i = items[0]?.dataIndex;
              return i != null ? formatDateBr(labels[i]) : '';
            },
            label(ctx) {
              const y = ctx.parsed.y;
              const pct =
                y != null ? indexedToPct(y)?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : null;
              const pctStr = pct != null ? `${pct}%` : '—';
              const isPortfolio = String(ctx.dataset.label || '').includes('(TWR %)');
              if (isPortfolio) {
                const i = ctx.dataIndex;
                const brl = i != null ? patrimonyBrl[i] : null;
                return [
                  `${ctx.dataset.label}: ${pctStr}`,
                  brl != null ? `Patrimônio: ${formatBrl(brl)}` : '',
                ].filter(Boolean);
              }
              return `${ctx.dataset.label}: ${pctStr}`;
            },
          },
        },
      },
      scales: {
        yIndex: {
          position: 'left',
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#94A3B8',
            maxTicksLimit: 8,
            callback: (v) => {
              const pct = indexedToPct(Number(v));
              if (pct == null) return '';
              return `${pct.toFixed(1)}%`;
            },
          },
        },
        x: {
          grid: { display: false },
          ticks: {
            color: '#94A3B8',
            maxRotation: 0,
            autoSkip: false,
            callback(_v, index) {
              const d = labels[index];
              if (!tickSet.has(d)) return '';
              return d.slice(5).replace('-', '/');
            },
          },
        },
      },
    },
  });

  applyVisibleAxisBounds(activeChart);
  activeChart.update('none');

  const syncChartLayout = () => {
    if (!activeChart || !wrap) return;
    activeChart.resize();
  };

  syncChartLayout();
  requestAnimationFrame(syncChartLayout);

  return { empty: false };
}

function sampleLabels(series) {
  const n = series.length;
  if (n <= 12) return series.map((p) => p.date);
  const step = Math.max(1, Math.floor((n - 1) / 11));
  const out = [];
  for (let i = 0; i < n; i += step) out.push(series[i].date);
  if (out[out.length - 1] !== series[n - 1].date) out.push(series[n - 1].date);
  return out;
}

export function destroyHoldingPatrimonyChart() {
  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }
}
