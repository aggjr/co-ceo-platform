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
  Title
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
  'filter.invest.options.all_assets',
  'filter.invest.options.all_types',
  'filter.invest.options.underlying',
  'filter.invest.options.type'
];

let currentChartQty = null;
let currentChartNotional = null;

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
      <div class="opt-cards-toolbar" style="align-items: flex-start; margin-bottom: 20px; gap: 20px;">
        <div class="multi-select-dropdown" id="amp-asset-dropdown">
          <label style="display:block; margin-bottom: 4px; color: var(--text-color); font-weight: bold;">Ativo (Ação)</label>
          <button type="button" class="multi-select-btn" id="amp-asset-btn">Selecionar Ações...</button>
          <div class="multi-select-content">
            ${underlyingsChecks}
          </div>
        </div>
        <label style="display:flex; flex-direction:column; gap:4px;">
          <span style="color: var(--text-color); font-weight: bold;">Data do Strike</span>
          <select data-filter="expiry" style="padding: 6px 12px; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid #334155; border-radius: 4px;">${expiryOpts}</select>
        </label>
      </div>
      <div class="amp-charts-wrapper" style="display: flex; flex-direction: column; gap: 40px; height: calc(100vh - 220px); min-height: 700px;">
        <div class="amp-chart-container" style="flex: 1; position: relative;">
          <canvas id="amp-chart-qty"></canvas>
        </div>
        <div class="amp-chart-container" style="flex: 1; position: relative;">
          <canvas id="amp-chart-notional"></canvas>
        </div>
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

    // 2. Aggregate by Strike -> Underlying -> Side
    const strikeMap = new Map();
    // To track current quotes for annotations
    const quoteMap = new Map(); 

    filtered.forEach(row => {
      const f = cardFieldRows(row);
      if (f.strike == null || !f.underlying) return;
      
      if (!strikeMap.has(f.strike)) {
        strikeMap.set(f.strike, {});
      }
      
      const st = strikeMap.get(f.strike);
      if (!st[f.underlying]) {
        st[f.underlying] = { callQty: 0, callNotional: 0, putQty: 0, putNotional: 0 };
      }

      const uObj = st[f.underlying];
      const absQty = Math.abs(f.quantity || 0);
      const absNotional = Math.abs(f.notional || 0);

      if (f.side === 'call') {
        uObj.callQty += absQty;
        uObj.callNotional += absNotional;
      } else if (f.side === 'put') {
        uObj.putQty += absQty;
        uObj.putNotional += absNotional;
      }

      if (f.underlyingQuote) {
        quoteMap.set(f.underlying, f.underlyingQuote);
      }
    });

    // 3. Prepare Chart Data
    const sortedStrikes = [...strikeMap.keys()].sort((a, b) => a - b);
    const labels = sortedStrikes.map(s => formatBrl(s));

    // Paleta de cores com "tom mais claro (Call)" e "tom mais escuro (Put)"
    const BASE_COLORS = [
      { call: 'rgba(125, 211, 252, 0.9)', put: 'rgba(2, 132, 199, 0.9)' },   // Azul Claro / Azul Escuro
      { call: 'rgba(253, 224, 71, 0.9)', put: 'rgba(161, 98, 7, 0.9)' },     // Amarelo Claro / Amarelo Escuro
      { call: 'rgba(134, 239, 172, 0.9)', put: 'rgba(21, 128, 61, 0.9)' },   // Verde Claro / Verde Escuro
      { call: 'rgba(252, 165, 165, 0.9)', put: 'rgba(185, 28, 28, 0.9)' },   // Vermelho Claro / Vermelho Escuro
      { call: 'rgba(216, 180, 254, 0.9)', put: 'rgba(126, 34, 206, 0.9)' },  // Roxo Claro / Roxo Escuro
      { call: 'rgba(253, 186, 116, 0.9)', put: 'rgba(194, 65, 12, 0.9)' }    // Laranja Claro / Laranja Escuro
    ];

    const activeUnderlyings = filters.underlyings.size > 0 ? [...filters.underlyings] : underlyings;
    const datasetsQty = [];
    const datasetsNotional = [];
    const annotations = {};

    function getFractionalIndex(quote, sortedStrikesList) {
      if (sortedStrikesList.length === 0) return 0;
      if (quote <= sortedStrikesList[0]) return 0;
      if (quote >= sortedStrikesList[sortedStrikesList.length - 1]) return sortedStrikesList.length - 1;
      for (let i = 0; i < sortedStrikesList.length - 1; i++) {
        const s1 = sortedStrikesList[i];
        const s2 = sortedStrikesList[i+1];
        if (quote >= s1 && quote <= s2) {
          const ratio = (quote - s1) / (s2 - s1);
          return i + ratio;
        }
      }
      return 0;
    }

    activeUnderlyings.forEach((u, i) => {
      const color = BASE_COLORS[i % BASE_COLORS.length];
      
      const cQty = sortedStrikes.map(s => strikeMap.get(s)[u]?.callQty || 0);
      const cNot = sortedStrikes.map(s => strikeMap.get(s)[u]?.callNotional || 0);
      const pQty = sortedStrikes.map(s => strikeMap.get(s)[u]?.putQty || 0);
      const pNot = sortedStrikes.map(s => strikeMap.get(s)[u]?.putNotional || 0);

      const hasCalls = cQty.some(v => v > 0);
      const hasPuts = pQty.some(v => v > 0);

      if (hasCalls) {
        datasetsQty.push({
          label: `${u} Call Qtd`, data: cQty, backgroundColor: color.call,
          barPercentage: 0.8, categoryPercentage: 0.8
        });
        datasetsNotional.push({
          label: `${u} Call Notional`, data: cNot, backgroundColor: color.call,
          barPercentage: 0.8, categoryPercentage: 0.8
        });
      }
      
      if (hasPuts) {
        datasetsQty.push({
          label: `${u} Put Qtd`, data: pQty, backgroundColor: color.put,
          barPercentage: 0.8, categoryPercentage: 0.8
        });
        datasetsNotional.push({
          label: `${u} Put Notional`, data: pNot, backgroundColor: color.put,
          barPercentage: 0.8, categoryPercentage: 0.8
        });
      }

      // Seta/Linha da Cotação
      const quote = quoteMap.get(u);
      if (quote != null) {
        const fracIndex = getFractionalIndex(quote, sortedStrikes);
        // Usa a cor clara da CALL para destacar no fundo escuro
        annotations[`line-${u}`] = {
          type: 'line',
          scaleID: 'x',
          value: fracIndex,
          borderColor: color.call, 
          borderWidth: 2,
          borderDash: [4, 4],
          label: {
            display: true,
            content: `▼ Cotação ${u}: ${formatBrl(quote)}`,
            position: i % 2 === 0 ? 'start' : 'end',
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            color: color.call,
            font: { size: 12, weight: 'bold' },
            padding: 6
          }
        };
      }
    });

    const canvasQty = document.getElementById('amp-chart-qty');
    const canvasNotional = document.getElementById('amp-chart-notional');
    if (!canvasQty || !canvasNotional) return;

    if (currentChartQty) {
      currentChartQty.destroy();
    }
    if (currentChartNotional) {
      currentChartNotional.destroy();
    }

    const commonOptions = {
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
        annotation: {
          annotations
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(148, 163, 184, 0.1)' }
        }
      }
    };

    // Render QTY Chart
    currentChartQty = new Chart(canvasQty, {
      type: 'bar',
      data: {
        labels,
        datasets: datasetsQty
      },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          title: {
            display: true,
            text: 'Quantidade de Opções por Strike',
            color: '#fff',
            font: { size: 16, weight: 'normal' },
            padding: { top: 10, bottom: 20 }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${formatNumber(context.raw, 0)}`;
              }
            }
          }
        },
        scales: {
          ...commonOptions.scales,
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          }
        }
      }
    });

    // Render NOTIONAL Chart
    currentChartNotional = new Chart(canvasNotional, {
      type: 'bar',
      data: {
        labels,
        datasets: datasetsNotional
      },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          title: {
            display: true,
            text: 'Notional (R$) por Strike',
            color: '#fff',
            font: { size: 16, weight: 'normal' },
            padding: { top: 10, bottom: 20 }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${formatBrl(context.raw)}`;
              }
            }
          }
        },
        scales: {
          ...commonOptions.scales,
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            ticks: {
              color: '#94a3b8',
              callback: function(value) {
                return formatBrl(value);
              }
            },
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          }
        }
      }
    });
  }

  renderFilters();
  paintChart();
}
