import '../styles/invest-dashboard.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import {
  mountHoldingPatrimonyChart,
  renderHoldingPatrimonySummary,
  destroyHoldingPatrimonyChart,
} from '../lib/holdingPatrimonyChart.js';
import { formatDateBr } from '../lib/dateFormat.js';
import { loadInvestUiContext, periodDefaults } from '../lib/investUiContext.js';

const D = 'div';

const REFRESH_ICON_SVG = `<svg class="header-sync-icon__svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08a5.99 5.99 0 0 1-5.65 4.13 5.99 5.99 0 0 1-5.65-4.13H4v2h7.99c4.42 0 7.99-3.58 7.99-8 0-1.74-.56-3.35-1.51-4.65l1.42-1.42L20 4v6h-6l2.65-2.65z"/></svg>`;

function localDateParts(d = new Date()) {
  return {
    y: d.getFullYear(),
    m: d.getMonth() + 1,
    day: d.getDate(),
  };
}

function toIsoDate(d) {
  const { y, m, day } = localDateParts(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

/** Último pregão fechado para o gráfico padrão (ontem no fuso local). */
function yesterdayIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return toIsoDate(d);
}

function clampToToday(dateStr, bounds) {
  const d = String(dateStr || bounds.defaultFrom).slice(0, 10);
  const max = bounds.today;
  const min = bounds.periodMin;
  if (d > max) return max;
  if (d < min) return min;
  return d;
}

function defaultTo(bounds) {
  const y = yesterdayIso();
  const t = bounds.today;
  return y < bounds.periodMin ? t : y;
}

function chartLegendLabel(data) {
  if (data?.patrimonySource === 'ledger_plus_btg_anchors') {
    return 'Holding (patrimônio ajustado BTG)';
  }
  if (data?.dailyRecording?.storedDaysInRange > 0) {
    return 'Patrimônio diário (fechamentos gravados)';
  }
  if (data?.marketQuotes?.usesHistoricalQuotes) {
    return 'Patrimônio diário (livro × cotações de mercado)';
  }
  return 'Patrimônio diário (livro-razão)';
}

function bindPatrimonyChart(container, initialBounds) {
  const fromInput = container.querySelector('#patrimony-from');
  const toInput = container.querySelector('#patrimony-to');
  const reloadBtn = container.querySelector('#patrimony-reload');
  const summaryHost = container.querySelector('#patrimony-summary');
  const chartHost = container.querySelector('#patrimony-chart-host');
  const metaHost = container.querySelector('#patrimony-meta');
  let bounds = initialBounds;

  const load = async () => {
    if (!chartHost) return;
    reloadBtn?.classList.add('btn-header-icon-sync--loading');
    reloadBtn?.setAttribute('aria-busy', 'true');
    destroyHoldingPatrimonyChart();
    chartHost.innerHTML =
      '<div class="holding-chart-canvas-wrap"><canvas id="holding-patrimony-canvas"></canvas></div>';
    if (summaryHost) summaryHost.innerHTML = '<p class="muted">Calculando série diária...</p>';
    try {
      const from = clampToToday(fromInput?.value || bounds.defaultFrom, bounds);
      const to = clampToToday(toInput?.value || defaultTo(bounds), bounds);
      if (fromInput) fromInput.value = from;
      if (toInput) {
        toInput.value = to;
        toInput.max = bounds.today;
        toInput.min = bounds.periodMin;
      }
      if (fromInput) fromInput.min = bounds.periodMin;

      const data = await apiRequest(
        `/api/invest/patrimony-daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&method=mtm_economic`
      );
      if (data?.periodBounds) bounds = periodDefaults(data.periodBounds);
      const today = todayIso();
      const series = (data.series || []).filter((p) => String(p.date).slice(0, 10) <= today);

      if (summaryHost) {
        summaryHost.innerHTML = renderHoldingPatrimonySummary(
          series,
          data.performance,
          data.btgReference,
          data.cashInTransit,
          data.cdiComparison,
          data.stockBenchmark
        );
      }

      const canvas = chartHost.querySelector('#holding-patrimony-canvas');
      if (canvas) {
        const todayChart = todayIso();
        const portfolioChartSeries = (data.portfolioIndexed || []).filter(
          (p) => String(p.date).slice(0, 10) <= todayChart
        );
        const result = mountHoldingPatrimonyChart(canvas, series, {
          datasetLabel: chartLegendLabel(data),
          portfolioChartSeries,
          performance: data.performance,
          cdiBenchmark: data.cdiBenchmark,
          stockBenchmark: data.stockBenchmark,
        });
        if (result.empty) {
          chartHost.innerHTML = `<p class="muted">Sem dados entre ${formatDateBr(from)} e ${formatDateBr(to)}. Importe abertura 01/01/2026, extrato e notas no livro-razão; depois sincronize cotações de mercado.</p>`;
        }
      }

      const lastStored = data?.dailyRecording?.lastStoredDate;
      if (toInput && lastStored && lastStored < to && series.length > 0) {
        const lastPoint = series[series.length - 1];
        if (String(lastPoint?.date).slice(0, 10) === lastStored) {
          toInput.value = lastStored;
        }
      }

      if (metaHost) {
        const displayTo = series.length
          ? String(series[series.length - 1].date).slice(0, 10)
          : to;
        metaHost.textContent = `Período: ${formatDateBr(from)} → ${formatDateBr(displayTo)} · ${series.length} dia(s).`;
      }
    } catch (err) {
      if (summaryHost) summaryHost.innerHTML = '';
      const banner = document.createElement(D);
      banner.className = 'error-banner';
      if (err.status === 404) {
        banner.textContent =
          'API de patrimônio não encontrada. Reinicie com npm run dev (porta 5173 + API 3001).';
      } else {
        banner.textContent =
          err.body?.error || err.message || 'Erro ao carregar patrimônio diário.';
      }
      chartHost.replaceChildren(banner);
    } finally {
      reloadBtn?.classList.remove('btn-header-icon-sync--loading');
      reloadBtn?.removeAttribute('aria-busy');
    }
  };

  reloadBtn?.addEventListener('click', load);
  fromInput?.addEventListener('change', load);
  toInput?.addEventListener('change', load);
  load();
}

export async function InvestDashboardPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(
    ['screen.invest.dashboard.title', 'label.common.period_from', 'label.common.period_to'],
    {
      'label.common.period_from': 'De',
      'label.common.period_to': 'Até',
    }
  );
  const screenTitle = t['screen.invest.dashboard.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
      contentHtml: `<${D} class="card"><h2 style="font-size:16px">INVEST</h2><p class="muted">Personifique o titular da holding para ver o gráfico patrimonial.</p></${D}>`,
    });
    return;
  }

  const uiCtx = await loadInvestUiContext();
  const bounds = periodDefaults(uiCtx);
  const toDefault = defaultTo(bounds);
  const contentHtml = `<${D} class="invest-patrimony-page">
    <${D} class="card invest-patrimony-card">
      <${D} class="table-period-toolbar patrimony-toolbar">
        <label>${t['label.common.period_from']} <input type="date" id="patrimony-from" value="${bounds.defaultFrom}" min="${bounds.periodMin}" /></label>
        <label>${t['label.common.period_to']} <input type="date" id="patrimony-to" value="${toDefault}" min="${bounds.periodMin}" max="${bounds.today}" /></label>
        <button type="button" id="patrimony-reload" class="btn btn-outline" title="Filtrar Datas" aria-label="Filtrar Datas" style="padding: 4px 12px; height: 32px;">Filtrar Datas</button>
      </${D}>
      <${D} id="patrimony-summary" class="patrimony-summary-host"></${D}>
      <p id="patrimony-meta" class="patrimony-meta muted"></p>
      <${D} class="patrimony-chart-section">
        <${D} id="patrimony-chart-host" class="patrimony-chart-panel">
          <p class="muted">Carregando...</p>
        </${D}>
      </${D}>
      <nav class="invest-patrimony-links" aria-label="Atalhos INVEST">
        <a href="/invest/portfolio" data-link>Portfólio →</a>
        · <a href="/invest/historico-operacoes" data-link>Notas / operações →</a>
        · <a href="/invest/ganhos-por-acao" data-link>Resultados por ação →</a>
        · <a href="/invest/conciliacao" data-link>Conciliação →</a>
      </nav>
    </${D}>
  </${D}>`;

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
    contentHtml,
  });
  bindPatrimonyChart(container, bounds);
}
