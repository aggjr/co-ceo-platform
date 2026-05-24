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

const D = 'div';
const PERIOD_START = '2025-12-31';

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

function defaultFrom() {
  return PERIOD_START;
}

function defaultTo() {
  const y = yesterdayIso();
  const t = todayIso();
  return y < PERIOD_START ? t : y;
}

function clampToToday(dateStr) {
  const d = String(dateStr || todayIso()).slice(0, 10);
  const max = todayIso();
  if (d > max) return max;
  if (d < PERIOD_START) return PERIOD_START;
  return d;
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

function renderDataStatus(data) {
  const mq = data?.marketQuotes;
  const rec = data?.dailyRecording;
  const lines = [];
  if (mq?.usesHistoricalQuotes) {
    lines.push(
      `<span class="patrimony-status-chip is-ok">Cotações: ${mq.tickersWithHistory} ativo(s), ${mq.quoteRowsInRange} dia(s) em market_quotes_daily</span>`
    );
  } else {
    lines.push(
      '<span class="patrimony-status-chip is-warn">Sem cotações históricas — rode sync/backfill de mercado</span>'
    );
  }
  if (rec?.storedDaysInRange > 0) {
    lines.push(
      `<span class="patrimony-status-chip is-ok">Fechamentos gravados: ${rec.storedDaysInRange} dia(s)</span>`
    );
  }
  if (data?.cdiBenchmark?.available) {
    lines.push(
      `<span class="patrimony-status-chip is-ok">CDI: ${data.cdiBenchmark.observationDays} dia(s)</span>`
    );
  } else {
    lines.push(
      '<span class="patrimony-status-chip is-warn">CDI ausente — npm run seed:market:benchmarks</span>'
    );
  }
  const stk = data?.stockBenchmark;
  if (stk?.available) {
    lines.push(
      `<span class="patrimony-status-chip is-ok">${stk.ticker}: ${stk.observationDays} fechamento(s)</span>`
    );
  } else {
    const t = data?.chartBenchmarkTicker || 'PRIO3';
    lines.push(
      `<span class="patrimony-status-chip is-warn">${t} sem histórico — npm run seed:market:benchmarks</span>`
    );
  }
  if (data?.extractReconciliation) {
    const ext = data.extractReconciliation;
    lines.push(
      `<span class="patrimony-status-chip">${ext.tedsMatchedWithLedger ? 'Extrato BTG alinhado ao livro' : 'Conferir TEDs extrato × livro'}</span>`
    );
  }
  return lines.length
    ? `<${D} class="patrimony-status-row">${lines.join('')}</${D}>`
    : '';
}

function bindPatrimonyChart(container) {
  const fromInput = container.querySelector('#patrimony-from');
  const toInput = container.querySelector('#patrimony-to');
  const reloadBtn = container.querySelector('#patrimony-reload');
  const summaryHost = container.querySelector('#patrimony-summary');
  const chartHost = container.querySelector('#patrimony-chart-host');
  const metaHost = container.querySelector('#patrimony-meta');
  const statusHost = container.querySelector('#patrimony-status');

  const load = async () => {
    if (!chartHost) return;
    destroyHoldingPatrimonyChart();
    chartHost.innerHTML =
      '<div class="holding-chart-canvas-wrap"><canvas id="holding-patrimony-canvas"></canvas></div>';
    if (summaryHost) summaryHost.innerHTML = '<p class="muted">Calculando série diária...</p>';
    if (statusHost) statusHost.innerHTML = '';

    try {
      const from = clampToToday(fromInput?.value || defaultFrom());
      const to = clampToToday(toInput?.value || defaultTo());
      if (fromInput) fromInput.value = from;
      if (toInput) {
        toInput.value = to;
        toInput.max = todayIso();
        toInput.min = PERIOD_START;
      }
      if (fromInput) fromInput.min = PERIOD_START;

      const data = await apiRequest(
        `/api/invest/patrimony-daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&method=mtm_btg`
      );
      const today = todayIso();
      const series = (data.series || []).filter((p) => String(p.date).slice(0, 10) <= today);

      if (statusHost) statusHost.innerHTML = renderDataStatus(data);

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
        const result = mountHoldingPatrimonyChart(canvas, series, {
          datasetLabel: chartLegendLabel(data),
          portfolioChartSeries: data.portfolioIndexed,
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
        const parts = [
          `Período: ${formatDateBr(from)} → ${formatDateBr(displayTo)} · ${series.length} dia(s) na curva.`,
          ...(data.performanceNotes || []),
        ].filter(Boolean);
        if (lastStored && lastStored < to) {
          parts.push(
            `Último fechamento gravado: ${formatDateBr(lastStored)} — rode record:patrimony:daily após importar livro e cotações para estender até ontem.`
          );
        }
        metaHost.textContent = parts.join(' ');
      }
    } catch (err) {
      if (summaryHost) summaryHost.innerHTML = '';
      if (statusHost) statusHost.innerHTML = '';
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
    { 'screen.invest.dashboard.title': 'Resultado histórico' }
  );
  const screenTitle = t['screen.invest.dashboard.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
      contentHtml: `<${D} class="card"><h2 style="font-size:16px">INVEST</h2><p class="muted">Personifique o titular da holding para ver o gráfico patrimonial.</p></${D}>`,
    });
    return;
  }

  const toDefault = defaultTo();
  const contentHtml = `<${D} class="invest-patrimony-page">
    <${D} class="card invest-patrimony-card">
      <${D} class="patrimony-toolbar">
        <${D}>
          <h2 style="font-size:18px;margin:0">${screenTitle}</h2>
          <p class="muted" style="margin:4px 0 0;font-size:13px">
            Rentabilidade acumulada (TWR): aportes e retiradas (TEDs) não distorcem a curva da carteira.
            Patrimônio em R$ no resumo e no tooltip. Padrão: 31/12/2025 até ontem.
          </p>
        </${D}>
        <label>De <input type="date" id="patrimony-from" value="${defaultFrom()}" min="${PERIOD_START}" /></label>
        <label>Até <input type="date" id="patrimony-to" value="${toDefault}" min="${PERIOD_START}" max="${todayIso()}" /></label>
        <button type="button" id="patrimony-reload" class="btn-entrar">Atualizar</button>
      </${D}>
      <${D} id="patrimony-status" class="patrimony-status-host"></${D}>
      <${D} id="patrimony-summary" class="patrimony-summary-host"></${D}>
      <${D} id="patrimony-chart-host" class="patrimony-chart-panel">
        <p class="muted">Carregando...</p>
      </${D}>
      <p id="patrimony-meta" class="patrimony-meta muted"></p>
      <nav class="invest-patrimony-links" aria-label="Atalhos INVEST">
        <a href="/invest/portfolio" data-link>Portfólio →</a>
        · <a href="/invest/extratos" data-link>Extratos →</a>
        · <a href="/invest/historico-operacoes" data-link>Notas / operações →</a>
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
