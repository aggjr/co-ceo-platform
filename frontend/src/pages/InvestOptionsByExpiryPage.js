import '../styles/invest-options-cards.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { formatDateBr } from '../lib/dateFormat.js';
import {
  cardFieldRows,
  uniqueUnderlyings,
  uniqueExpiryDatesForUnderlying,
} from '../lib/optionPortfolioModel.js';
import { formatBrl, formatNumber } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';
import { apiRequest } from '../api/client.js';

import {
  Chart,
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Title,
  annotationPlugin
);

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TEXT_KEYS = [
  'screen.invest.options.expiry.title',
  'filter.invest.options.underlying',
];

/** Mesma paleta ITUB: call clara, put escura — uma ação por vez. */
const AMP_COLORS = {
  call: 'rgba(125, 211, 252, 0.9)',
  put: 'rgba(2, 132, 199, 0.9)',
  quoteLine: 'rgba(125, 211, 252, 1)',
};

let currentChartQty = null;
let currentChartNotional = null;

/** Eixo X numérico (R$ strike) — distância visual proporcional ao valor do strike. */
function ampLinearXScale(sortedStrikes, quote) {
  let minS = sortedStrikes[0];
  let maxS = sortedStrikes[sortedStrikes.length - 1];
  if (quote != null && Number.isFinite(Number(quote))) {
    minS = Math.min(minS, Number(quote));
    maxS = Math.max(maxS, Number(quote));
  }
  const span = maxS - minS || 1;
  const pad = Math.max(0.5, span * 0.025);
  return {
    type: 'linear',
    min: minS - pad,
    max: maxS + pad,
    grid: { color: 'rgba(148, 163, 184, 0.1)' },
    ticks: {
      color: '#94a3b8',
      maxRotation: 45,
      minRotation: 45,
      autoSkip: false,
      values: sortedStrikes,
      callback: (value) => formatBrl(Number(value)),
    },
  };
}

function ampBarDataset(label, sortedStrikes, volumeByStrike, field, color) {
  const data = sortedStrikes.map((s) => ({
    x: s,
    y: volumeByStrike.get(s)[field],
  }));
  if (!data.some((p) => p.y > 0)) return null;
  return {
    label,
    data,
    parsing: false,
    backgroundColor: color,
    maxBarThickness: 14,
  };
}

function ampTooltipLabel(ctx, formatValue) {
  const y = ctx.parsed?.y ?? 0;
  const x = ctx.parsed?.x;
  const strike =
    x != null && Number.isFinite(Number(x)) ? formatBrl(Number(x)) : '—';
  return `${ctx.dataset.label}: ${formatValue(y)} · strike ${strike}`;
}

function strikesFromPortfolio(rows, underlying, expiry) {
  const set = new Set();
  for (const row of rows) {
    const f = cardFieldRows(row);
    if (f.strike == null) continue;
    if (String(f.underlying || '').toUpperCase() !== underlying) continue;
    if (String(f.expiry || '').slice(0, 10) !== expiry) continue;
    set.add(f.strike);
  }
  return [...set].sort((a, b) => a - b);
}

export async function InvestOptionsByExpiryPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(TEXT_KEYS);
  const title = t['screen.invest.options.expiry.title'] || 'Ampulheta';

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST - ${title}`,
      contentHtml: `<div class="card"><p class="muted">Personifique o titular da holding para ver opções.</p></div>`,
    });
    return;
  }

  let allRows = [];
  try {
    allRows = await fetchOpenOptionsPortfolio();
  } catch (err) {
    await renderShell(container, {
      title: `INVEST - ${title}`,
      contentHtml: `<div class="error-banner">${escapeHtml(err.message)}</div>`,
    });
    return;
  }

  const underlyings = uniqueUnderlyings(allRows);
  if (!underlyings.length) {
    await renderShell(container, {
      title: `INVEST - ${title}`,
      contentHtml: `<div class="card"><p class="muted">Nenhuma opção em carteira.</p></div>`,
    });
    return;
  }

  const filters = {
    underlying: underlyings[0],
    expiry: '',
  };

  const expiryDatesForUnderlying = () =>
    uniqueExpiryDatesForUnderlying(allRows, filters.underlying);

  function ensureExpiryDefault() {
    const dates = expiryDatesForUnderlying();
    if (!dates.length) {
      filters.expiry = '';
      return;
    }
    if (!dates.includes(filters.expiry)) {
      filters.expiry = dates[0];
    }
  }

  ensureExpiryDefault();

  const hostId = 'opt-amp-root';

  await renderShell(container, {
    title: `INVEST - ${title}`,
    contentHtml: `<div class="card invest-table-card" id="${hostId}"></div>`,
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  function renderFilters() {
    const dates = expiryDatesForUnderlying();
    const underlyingOpts = underlyings
      .map(
        (u) =>
          `<option value="${escapeHtml(u)}"${filters.underlying === u ? ' selected' : ''}>${escapeHtml(u)}</option>`
      )
      .join('');

    const expiryOpts = dates
      .map(
        (e) =>
          `<option value="${escapeHtml(e)}"${filters.expiry === e ? ' selected' : ''}>${escapeHtml(formatDateBr(e))}</option>`
      )
      .join('');

    root.innerHTML = `
      <div class="opt-cards-toolbar amp-toolbar" style="margin-bottom: 20px; gap: 20px;">
        <label class="amp-filter-label">
          <span>Ativo (Ação)</span>
          <select data-filter="underlying" class="amp-filter-select">${underlyingOpts}</select>
        </label>
        <label class="amp-filter-label">
          <span>Data do Strike</span>
          <select data-filter="expiry" class="amp-filter-select"${dates.length ? '' : ' disabled'}>${expiryOpts || '<option value="">—</option>'}</select>
        </label>
      </div>
      <p class="amp-chart-hint muted" id="amp-hint"></p>
      <div class="amp-charts-wrapper" style="display: flex; flex-direction: column; gap: 40px; height: calc(100vh - 240px); min-height: 700px;">
        <div class="amp-chart-container" style="flex: 1; position: relative;">
          <canvas id="amp-chart-qty"></canvas>
        </div>
        <div class="amp-chart-container" style="flex: 1; position: relative;">
          <canvas id="amp-chart-notional"></canvas>
        </div>
      </div>
    `;

    root.querySelector('[data-filter="underlying"]').addEventListener('change', (e) => {
      filters.underlying = e.target.value;
      ensureExpiryDefault();
      renderFilters();
      void paintChart();
    });

    root.querySelector('[data-filter="expiry"]').addEventListener('change', (e) => {
      filters.expiry = e.target.value;
      void paintChart();
    });
  }

  async function paintChart() {
    const hint = root.querySelector('#amp-hint');
    const underlying = filters.underlying;
    const expiry = filters.expiry;

    if (!underlying || !expiry) {
      if (hint) {
        hint.textContent = 'Selecione ação e data do strike para exibir os gráficos.';
      }
      return;
    }

    let sortedStrikes = [];
    let quote = null;

    try {
      const ladder = await apiRequest(
        `/api/invest/options/strike-ladder?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}`
      );
      sortedStrikes = (ladder.strikes || [])
        .map((s) => Number(s))
        .filter((s) => Number.isFinite(s) && s > 0)
        .sort((a, b) => a - b);
      if (ladder.quote != null && Number(ladder.quote) > 0) {
        quote = Number(ladder.quote);
      }
    } catch {
      /* fallback só custódia */
    }

    const portfolioStrikes = strikesFromPortfolio(allRows, underlying, expiry);
    if (!sortedStrikes.length) {
      sortedStrikes = portfolioStrikes;
    } else {
      const merged = new Set([...sortedStrikes, ...portfolioStrikes]);
      sortedStrikes = [...merged].sort((a, b) => a - b);
    }

    if (!sortedStrikes.length) {
      if (hint) {
        hint.textContent =
          'Sem strikes na grade de mercado para esta data. Rode sync de opções (opcoes.net) ou confira a data.';
      }
      if (currentChartQty) currentChartQty.destroy();
      if (currentChartNotional) currentChartNotional.destroy();
      currentChartQty = null;
      currentChartNotional = null;
      return;
    }

    if (hint) {
      hint.textContent = `${underlying} · vencimento ${formatDateBr(expiry)} · ${sortedStrikes.length} strikes na grade`;
    }

    let filtered = allRows.filter(
      (r) =>
        String(r.underlying || '').toUpperCase() === underlying &&
        String(r.optionExpiryDate || '').slice(0, 10) === expiry
    );

    const volumeByStrike = new Map();
    for (const s of sortedStrikes) {
      volumeByStrike.set(s, { callQty: 0, callNotional: 0, putQty: 0, putNotional: 0 });
    }

    filtered.forEach((row) => {
      const f = cardFieldRows(row);
      if (f.strike == null || !volumeByStrike.has(f.strike)) return;
      const bucket = volumeByStrike.get(f.strike);
      const absQty = Math.abs(f.quantity || 0);
      const absNotional = Math.abs(f.notional || 0);
      if (f.side === 'call') {
        bucket.callQty += absQty;
        bucket.callNotional += absNotional;
      } else if (f.side === 'put') {
        bucket.putQty += absQty;
        bucket.putNotional += absNotional;
      }
      if (quote == null && f.underlyingQuote > 0) {
        quote = f.underlyingQuote;
      }
    });

    const datasetsQty = [
      ampBarDataset(
        `${underlying} Call Qtd`,
        sortedStrikes,
        volumeByStrike,
        'callQty',
        AMP_COLORS.call
      ),
      ampBarDataset(
        `${underlying} Put Qtd`,
        sortedStrikes,
        volumeByStrike,
        'putQty',
        AMP_COLORS.put
      ),
    ].filter(Boolean);

    const datasetsNotional = [
      ampBarDataset(
        `${underlying} Call Notional`,
        sortedStrikes,
        volumeByStrike,
        'callNotional',
        AMP_COLORS.call
      ),
      ampBarDataset(
        `${underlying} Put Notional`,
        sortedStrikes,
        volumeByStrike,
        'putNotional',
        AMP_COLORS.put
      ),
    ].filter(Boolean);

    const annotations = {};
    if (quote != null) {
      annotations['quote-line'] = {
        type: 'line',
        scaleID: 'x',
        value: quote,
        borderColor: AMP_COLORS.quoteLine,
        borderWidth: 2,
        borderDash: [4, 4],
        label: {
          display: true,
          content: `▼ Cotação ${underlying}: ${formatBrl(quote)}`,
          position: 'start',
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          color: AMP_COLORS.quoteLine,
          font: { size: 12, weight: 'bold' },
          padding: 6,
        },
      };
    }

    const canvasQty = document.getElementById('amp-chart-qty');
    const canvasNotional = document.getElementById('amp-chart-notional');
    if (!canvasQty || !canvasNotional) return;

    if (currentChartQty) currentChartQty.destroy();
    if (currentChartNotional) currentChartNotional.destroy();

    const xScale = ampLinearXScale(sortedStrikes, quote);

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#cbd5e1' } },
        annotation: { annotations },
      },
      scales: {
        x: xScale,
      },
    };

    currentChartQty = new Chart(canvasQty, {
      type: 'bar',
      data: { datasets: datasetsQty },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          title: {
            display: true,
            text: 'Quantidade de Opções por Strike',
            color: '#fff',
            font: { size: 16, weight: 'normal' },
            padding: { top: 10, bottom: 20 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ampTooltipLabel(ctx, (v) => formatNumber(v, 0)),
            },
          },
        },
        scales: {
          ...commonOptions.scales,
          y: {
            type: 'linear',
            display: true,
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
          },
        },
      },
    });

    currentChartNotional = new Chart(canvasNotional, {
      type: 'bar',
      data: { datasets: datasetsNotional },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          title: {
            display: true,
            text: 'Notional (R$) por Strike',
            color: '#fff',
            font: { size: 16, weight: 'normal' },
            padding: { top: 10, bottom: 20 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ampTooltipLabel(ctx, (v) => formatBrl(v)),
            },
          },
        },
        scales: {
          ...commonOptions.scales,
          y: {
            type: 'linear',
            display: true,
            ticks: {
              color: '#94a3b8',
              callback: (value) => formatBrl(value),
            },
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
          },
        },
      },
    });
  }

  renderFilters();
  void paintChart();
}
