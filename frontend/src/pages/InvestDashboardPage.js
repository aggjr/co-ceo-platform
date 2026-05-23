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

const D = 'div';

function defaultFrom() {
  return '2025-12-31';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultTo() {
  return todayIso();
}

function clampToToday(dateStr) {
  const d = String(dateStr || todayIso()).slice(0, 10);
  return d > todayIso() ? todayIso() : d;
}

function bindPatrimonyChart(container) {
  const fromInput = container.querySelector('#patrimony-from');
  const toInput = container.querySelector('#patrimony-to');
  const reloadBtn = container.querySelector('#patrimony-reload');
  const summaryHost = container.querySelector('#patrimony-summary');
  const chartHost = container.querySelector('#patrimony-chart-host');
  const metaHost = container.querySelector('#patrimony-meta');

  const load = async () => {
    if (!chartHost) return;
    destroyHoldingPatrimonyChart();
    chartHost.innerHTML =
      '<div class="holding-chart-canvas-wrap"><canvas id="holding-patrimony-canvas"></canvas></div>';
    if (summaryHost) summaryHost.innerHTML = '<p class="muted">Calculando...</p>';

    try {
      const from = fromInput?.value || defaultFrom();
      const to = clampToToday(toInput?.value || defaultTo());
      if (toInput && toInput.value !== to) toInput.value = to;

      const data = await apiRequest(
        `/api/invest/patrimony-daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      const today = todayIso();
      const series = (data.series || []).filter((p) => String(p.date).slice(0, 10) <= today);

      if (summaryHost) {
        summaryHost.innerHTML = renderHoldingPatrimonySummary(
          series,
          data.performance,
          data.btgReference,
          data.cashInTransit
        );
      }

      const canvas = chartHost.querySelector('#holding-patrimony-canvas');
      if (canvas) {
        const result = mountHoldingPatrimonyChart(canvas, series);
        if (result.empty) {
          chartHost.innerHTML =
            '<p class="muted">Sem dados no período — importe o livro-razão em Resultado.</p>';
        }
      }

      if (metaHost) {
        const parts = [
          data.meta?.note,
          ...(data.performanceNotes || []),
          data.patrimonySource === 'ledger_only'
            ? 'Fonte: somente livro-razão (base zerada ou sem custódia RV).'
            : null,
        ].filter(Boolean);
        metaHost.textContent = parts.join(' ');
      }
    } catch (err) {
      if (summaryHost) summaryHost.innerHTML = '';
      const banner = document.createElement(D);
      banner.className = 'error-banner';
      if (err.status === 404) {
        banner.textContent =
          'API de patrimônio não encontrada. Recompile e reinicie o servidor (npm run build && npm start), ou use npm run dev (porta 5173).';
      } else {
        banner.textContent = err.message || 'Erro ao carregar patrimônio diário.';
      }
      chartHost.replaceChildren(banner);
    }
  };

  reloadBtn?.addEventListener('click', load);
  load();
}

export async function InvestDashboardPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(
    ['screen.invest.dashboard.title'],
    { 'screen.invest.dashboard.title': 'Resultado Histórico' }
  );
  const screenTitle = t['screen.invest.dashboard.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
      contentHtml: `<${D} class="card"><h2 style="font-size:16px">INVEST</h2><p class="muted">Personifique o titular da holding para ver o gráfico patrimonial.</p></${D}>`,
    });
    return;
  }

  const contentHtml = `<${D} class="invest-patrimony-page">
    <${D} class="card invest-patrimony-card">
      <${D} class="patrimony-toolbar">
        <${D}>
          <h2 style="font-size:18px;margin:0">${screenTitle}</h2>
          <p class="muted" style="margin:4px 0 0;font-size:13px">
            Curva diária (livro-razão + âncoras BTG).
          </p>
        </${D}>
        <label>De <input type="date" id="patrimony-from" value="${defaultFrom()}" /></label>
        <label>Até <input type="date" id="patrimony-to" value="${defaultTo()}" max="${todayIso()}" /></label>
        <button type="button" id="patrimony-reload" class="btn-entrar">Atualizar</button>
      </${D}>
      <${D} id="patrimony-summary" class="patrimony-summary-host"></${D}>
      <${D} id="patrimony-chart-host" class="patrimony-chart-panel">
        <p class="muted">Carregando...</p>
      </${D}>
      <p id="patrimony-meta" class="patrimony-meta muted"></p>
      <nav class="invest-patrimony-links" aria-label="Atalhos INVEST">
        <a href="/invest/portfolio" data-link>Portfólio →</a>
        · <a href="/invest/ganhos-por-acao" data-link>Resultados por ação →</a>
      </nav>
    </${D}>
  </${D}>`;

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
    contentHtml,
  });
  bindPatrimonyChart(container);
}
