import '../styles/invest-pivot.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { mountPivotExcelTable, renderPivotTable } from '../lib/pivotDisplay.js';
import { formatBrl } from '../lib/portfolioDisplay.js';
import { loadInvestUiContext, periodDefaults } from '../lib/investUiContext.js';

function bindPivotPage(container, initialBounds) {
  const fromInput = container.querySelector('#pivot-from');
  const toInput = container.querySelector('#pivot-to');
  const reloadBtn = container.querySelector('#pivot-reload');
  const host = container.querySelector('#pivot-host');
  const summaryHost = container.querySelector('#pivot-summary');
  let bounds = initialBounds;

  const load = async () => {
    if (!host) return;
    host.innerHTML = '<p class="muted">Calculando...</p>';
    try {
      const from = (fromInput?.value || bounds.defaultFrom).slice(0, 10);
      const to = (toInput?.value || bounds.today).slice(0, 10);
      const data = await apiRequest(
        `/api/invest/pnl-pivot?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (data?.periodBounds) bounds = periodDefaults(data.periodBounds);
      const pivot = data.pivot;
      if (summaryHost && pivot?.totals) {
        summaryHost.innerHTML = `<p class="muted">Período <strong>${pivot.from}</strong> a <strong>${pivot.to}</strong> — resultado líquido agregado: <strong class="portfolio-pnl--up">${formatBrl(pivot.totals.total)}</strong> · custódia recalculada: <strong>${pivot.custody?.positions ?? 0}</strong> posições</p>`;
      }
      host.innerHTML = renderPivotTable(pivot, data.columnLabels || {});
      mountPivotExcelTable(host);
    } catch (err) {
      host.innerHTML = `<div class="error-banner">${err.message || 'Erro ao carregar pivot.'}</div>`;
    }
  };

  reloadBtn?.addEventListener('click', load);
  load();
}

function bindImportPanel(container) {
  const textarea = container.querySelector('#import-json');
  const runBtn = container.querySelector('#import-run');
  const templateBtn = container.querySelector('#import-template');
  const status = container.querySelector('#import-status');

  templateBtn?.addEventListener('click', async () => {
    try {
      const res = await fetch('/data/invest/import-template.json');
      if (!res.ok) throw new Error('Template não encontrado');
      const json = await res.json();
      if (textarea) textarea.value = JSON.stringify(json, null, 2);
      if (status) status.textContent = 'Modelo carregado — substitua pelos seus dados reais.';
    } catch (e) {
      if (status) status.textContent = e.message || 'Falha ao carregar modelo.';
    }
  });

  runBtn?.addEventListener('click', async () => {
    if (!textarea?.value.trim()) {
      if (status) status.textContent = 'Cole o JSON da carteira e das notas.';
      return;
    }
    runBtn.disabled = true;
    if (status) status.textContent = 'Importando e recalculando custódia...';
    try {
      const payload = JSON.parse(textarea.value);
      const result = await apiRequest('/api/invest/ledger/import', {
        method: 'POST',
        body: payload,
      });
      if (status) {
        status.textContent = `Importado: ${result.inserted} lançamentos (lote ${result.batchId}). Custódia: ${result.reconcile?.positions ?? 0} posições.`;
      }
      container.querySelector('#pivot-reload')?.click();
    } catch (err) {
      if (status) status.textContent = err.message || 'Importação falhou.';
    } finally {
      runBtn.disabled = false;
    }
  });
}

export async function InvestResultadoPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts([
    'screen.invest.resultado.title',
    'screen.invest.resultado.import_title',
    'screen.invest.resultado.import_help',
    'label.common.period_from',
    'label.common.period_to',
    'action.common.load_template',
    'action.common.import_recalc',
  ]);
  const screenTitle = t['screen.invest.resultado.title'];
  const bounds = periodDefaults(await loadInvestUiContext());

  if (isGlobalSession()) {
    const body = `
      <div class="card">
        <h2 style="font-size:16px">${screenTitle}</h2>
        <p class="muted">Personifique o titular da holding para importar notas e ver o pivot de lucros.</p>
      </div>
    `;
    await renderShell(container, { title: `INVEST — ${screenTitle}`, contentHtml: body });
    return;
  }

  const content = `
    <div class="card import-panel">
      <h2 style="font-size:16px;margin-bottom:8px">${t['screen.invest.resultado.import_title']}</h2>
      <p class="muted">${t['screen.invest.resultado.import_help']}</p>
      <textarea id="import-json" placeholder='{"opening_date":"","opening_positions":[],"entries":[]}'></textarea>
      <div class="import-actions">
        <button type="button" id="import-template" class="secondary">${t['action.common.load_template']}</button>
        <button type="button" id="import-run">${t['action.common.import_recalc']}</button>
      </div>
      <p id="import-status" class="import-status muted"></p>
    </div>

    <div class="card invest-table-card" style="margin-top:20px">
      <div class="table-period-toolbar">
        <label>${t['label.common.period_from']} <input type="date" id="pivot-from" value="${bounds.defaultFrom}" min="${bounds.periodMin}" /></label>
        <label>${t['label.common.period_to']} <input type="date" id="pivot-to" value="${bounds.today}" min="${bounds.periodMin}" max="${bounds.today}" /></label>
        <button type="button" id="pivot-reload" class="btn-entrar">Atualizar Rentabilidade</button>
      </div>
      <div id="pivot-summary" class="table-period-summary"></div>
      <div id="pivot-host"><p class="muted">Carregando...</p></div>
    </div>
  `;

  await renderShell(container, { title: `INVEST — ${screenTitle}`, contentHtml: content });
  bindImportPanel(container);
  bindPivotPage(container, bounds);
}
