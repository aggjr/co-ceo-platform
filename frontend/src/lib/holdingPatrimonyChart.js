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

function renderCashTransitBlock(cashInTransit) {
  if (!cashInTransit) return '';
  return `<div class="holding-summary-side muted" style="margin-top:8px;text-align:left">
    <span>Conta corrente: <strong>${formatBrl(cashInTransit.settledCashBalance)}</strong></span>
    <span>Em trânsito: <strong>${formatBrl(cashInTransit.inTransitNet)}</strong>
      (receber ${formatBrl(cashInTransit.receivables)} · pagar ${formatBrl(Math.abs(cashInTransit.payables || 0))})</span>
  </div>`;
}

export function renderHoldingPatrimonySummary(series, performance, btgReference, cashInTransit) {
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
    return `
    <div class="holding-summary">
      <div class="holding-summary-main">
        <span class="holding-summary-label">Patrimônio líquido (holding)</span>
        <strong class="holding-summary-value">${formatBrl(last.patrimony)}</strong>
        <span class="holding-summary-change ${positive ? 'is-positive' : 'is-negative'}">
          Ganho ${positive ? '+' : ''}${formatBrl(gain)} · rentab. ${formatPct(twr)} (TWR)
        </span>
        <span class="muted" style="font-size:12px;display:block;margin-top:4px">
          TWR por fechamentos mensais BTG — ${flowsNote}. Proventos e operações entram no rendimento.
        </span>
        ${
          performance.periodReturnTwrDaily != null &&
          Math.abs(performance.periodReturnTwrDaily - twr) > 0.005
            ? `<span class="muted" style="font-size:11px;display:block;margin-top:2px">
                TWR série diária (diagnóstico): ${formatPct(performance.periodReturnTwrDaily)}
              </span>`
            : ''
        }
        ${anchorLine}
        ${btgLine}
      </div>
      <div class="holding-summary-side muted">
        <span>${formatDateBr(first.date)} → ${formatDateBr(last.date)}</span>
        <span>${series.length} dias</span>
        ${renderCashTransitBlock(cashInTransit)}
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
export function mountHoldingPatrimonyChart(canvas, series) {
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
  const values = clipped.map((p) => Number(p.patrimony));
  const tickSet = new Set(sampleLabels(clipped));

  const gold = '#DAB177';
  const goldFill = 'rgba(218, 177, 119, 0.12)';

  activeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Holding (patrimônio ajustado BTG)',
          data: values,
          borderColor: gold,
          backgroundColor: goldFill,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointRadius: 0,
          pointHitRadius: 8,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94A3B8', boxWidth: 12, padding: 16 },
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
              return `Patrimônio: ${formatBrl(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#94A3B8',
            maxTicksLimit: 8,
            callback: (v) => formatBrl(Number(v)),
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
