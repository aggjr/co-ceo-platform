import '../styles/invest-options-cards.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { formatDateBr } from '../lib/dateFormat.js';
import {
  cardFieldRows,
  uniqueUnderlyings,
  uniqueExpiryDates
} from '../lib/optionPortfolioModel.js';
import { formatBrl, formatNumber } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';

import {
  Chart,
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
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
  'filter.invest.options.all_assets',
  'filter.invest.options.all_types',
  'filter.invest.options.underlying',
  'filter.invest.options.type'
];

let currentChart = null;

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
  const expiries = uniqueExpiryDates(allRows);

  // Filters state
  const filters = {
    underlyings: new Set(),
    expiry: ''
  };

  const hostId = 'opt-amp-root';

  await renderShell(container, {
    title: `INVEST - ${title}`,
    contentHtml: `<div class="card invest-table-card" id="${hostId}"></div>`,
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  function renderFilters() {
    const expiryOpts = [
      `<option value="">Todas as Datas</option>`,
      ...expiries.map(
        (e) => `<option value="${escapeHtml(e)}"${filters.expiry === e ? ' selected' : ''}>${escapeHtml(formatDateBr(e))}</option>`
      ),
    ].join('');

    const underlyingsChecks = underlyings.map(u => {
      const checked = filters.underlyings.has(u) ? 'checked' : '';
      return `<label><input type="checkbox" value="${escapeHtml(u)}" ${checked} data-filter-asset /> ${escapeHtml(u)}</label>`;
    }).join('');

    root.innerHTML = `
      <div class="opt-cards-toolbar" style="align-items: flex-start; margin-bottom: 20px;">
        <div class="multi-select-dropdown" id="amp-asset-dropdown">
          <label style="display:block; margin-bottom: 4px; color: var(--text-color);">Ativo (Ação)</label>
          <button type="button" class="multi-select-btn" id="amp-asset-btn">Selecionar Ações...</button>
          <div class="multi-select-content">
            ${underlyingsChecks}
          </div>
        </div>
        <label>Data de Vencimento
          <select data-filter="expiry">${expiryOpts}</select>
        </label>
      </div>
      <div class="amp-chart-container">
        <canvas id="amp-chart-canvas"></canvas>
      </div>
    `;

    // Dropdown logic
    const dropdown = root.querySelector('#amp-asset-dropdown');
    const btn = root.querySelector('#amp-asset-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });

    root.querySelectorAll('[data-filter-asset]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) filters.underlyings.add(cb.value);
        else filters.underlyings.delete(cb.value);
        
        // Update button text
        const size = filters.underlyings.size;
        btn.textContent = size === 0 ? 'Todas as Ações' : size === 1 ? [...filters.underlyings][0] : `${size} Ações`;
        
        paintChart();
      });
    });

    root.querySelector('[data-filter="expiry"]').addEventListener('change', (e) => {
      filters.expiry = e.target.value;
      paintChart();
    });
  }

  function paintChart() {
    // 1. Filter rows
    let filtered = allRows;
    if (filters.underlyings.size > 0) {
      filtered = filtered.filter(r => filters.underlyings.has(r.underlying));
    }
    if (filters.expiry) {
      filtered = filtered.filter(r => (r.optionExpiryDate || '').slice(0, 10) === filters.expiry);
    }

    // 2. Aggregate by Strike
    const strikeMap = new Map();
    // To track current quotes for annotations
    const quoteMap = new Map(); 

    filtered.forEach(row => {
      const f = cardFieldRows(row);
      if (f.strike == null) return;
      
      if (!strikeMap.has(f.strike)) {
        strikeMap.set(f.strike, { callQty: 0, callNotional: 0, putQty: 0, putNotional: 0 });
      }
      
      const st = strikeMap.get(f.strike);
      const absQty = Math.abs(f.quantity || 0);
      const absNotional = Math.abs(f.notional || 0);

      if (f.side === 'call') {
        st.callQty += absQty;
        st.callNotional += absNotional;
      } else if (f.side === 'put') {
        st.putQty += absQty;
        st.putNotional += absNotional;
      }

      if (f.underlying && f.underlyingQuote) {
        quoteMap.set(f.underlying, f.underlyingQuote);
      }
    });

    // 3. Prepare Chart Data
    const sortedStrikes = [...strikeMap.keys()].sort((a, b) => a - b);
    const labels = sortedStrikes.map(s => formatBrl(s));

    const dataCallQty = sortedStrikes.map(s => strikeMap.get(s).callQty);
    const dataCallNotional = sortedStrikes.map(s => strikeMap.get(s).callNotional);
    const dataPutQty = sortedStrikes.map(s => strikeMap.get(s).putQty);
    const dataPutNotional = sortedStrikes.map(s => strikeMap.get(s).putNotional);

    function getFractionalIndex(quote, sortedStrikes) {
      if (sortedStrikes.length === 0) return 0;
      if (quote <= sortedStrikes[0]) return 0;
      if (quote >= sortedStrikes[sortedStrikes.length - 1]) return sortedStrikes.length - 1;
      for (let i = 0; i < sortedStrikes.length - 1; i++) {
        const s1 = sortedStrikes[i];
        const s2 = sortedStrikes[i+1];
        if (quote >= s1 && quote <= s2) {
          const ratio = (quote - s1) / (s2 - s1);
          return i + ratio;
        }
      }
      return 0;
    }

    const annotations = {};
    if (filters.underlyings.size > 0) {
      [...filters.underlyings].forEach((u, i) => {
        const quote = quoteMap.get(u);
        if (quote != null) {
          const fracIndex = getFractionalIndex(quote, sortedStrikes);
          annotations[`line-${u}`] = {
            type: 'line',
            scaleID: 'x',
            value: fracIndex,
            borderColor: 'rgba(255, 255, 255, 0.8)',
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
              display: true,
              content: `${u}: ${formatBrl(quote)}`,
              position: i % 2 === 0 ? 'start' : 'end',
              backgroundColor: 'rgba(0,0,0,0.7)',
              color: 'white',
              font: { size: 10 }
            }
          };
        }
      });
    }

    const canvas = document.getElementById('amp-chart-canvas');
    if (!canvas) return;

    if (currentChart) {
      currentChart.destroy();
    }

    currentChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Call Qtd',
            data: dataCallQty,
            backgroundColor: 'rgba(234, 88, 12, 0.8)', // Orange
            yAxisID: 'yQty',
            barPercentage: 0.8,
            categoryPercentage: 0.8
          },
          {
            label: 'Call Notional',
            data: dataCallNotional,
            backgroundColor: 'rgba(234, 88, 12, 0.3)', // Light Orange
            borderColor: 'rgba(234, 88, 12, 1)',
            borderWidth: 1,
            yAxisID: 'yNotional',
            barPercentage: 0.8,
            categoryPercentage: 0.8
          },
          {
            label: 'Put Qtd',
            data: dataPutQty,
            backgroundColor: 'rgba(56, 189, 248, 0.8)', // Blue
            yAxisID: 'yQty',
            barPercentage: 0.8,
            categoryPercentage: 0.8
          },
          {
            label: 'Put Notional',
            data: dataPutNotional,
            backgroundColor: 'rgba(56, 189, 248, 0.3)', // Light Blue
            borderColor: 'rgba(56, 189, 248, 1)',
            borderWidth: 1,
            yAxisID: 'yNotional',
            barPercentage: 0.8,
            categoryPercentage: 0.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#cbd5e1' }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.dataset.yAxisID === 'yNotional') {
                  label += formatBrl(context.raw);
                } else {
                  label += formatNumber(context.raw, 0);
                }
                return label;
              }
            }
          },
          annotation: {
            annotations
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          },
          yQty: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Quantidade', color: '#cbd5e1' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          },
          yNotional: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Notional (R$)', color: '#cbd5e1' },
            ticks: {
              color: '#94a3b8',
              callback: function(value) {
                return formatBrl(value);
              }
            },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  renderFilters();
  paintChart();
}
