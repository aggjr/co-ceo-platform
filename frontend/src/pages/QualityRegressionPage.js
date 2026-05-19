import '../styles/quality-regression.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { COCKPIT_EXCEL_THEME, mountCoCeoExcelGrid } from '../lib/coCeoExcelGrid.js';

function statusBadge(ok, label) {
  const cls = ok ? 'quality-badge--ok' : 'quality-badge--fail';
  return `<span class="quality-badge ${cls}">${label}</span>`;
}

function formatFuncs(functionalities) {
  if (!functionalities?.length) return '—';
  return functionalities.map((f) => f.label).join(', ');
}

function mountUnitsGrid(host, units) {
  mountCoCeoExcelGrid(host, {
    gridId: 'quality-units-v1',
    tableTheme: COCKPIT_EXCEL_THEME,
    coCeoColumns: [
      {
        key: 'label',
        label: 'Unidade',
        type: 'text',
        width: '200px',
        sticky: true,
        render: (u) => {
          const el = document.createElement('div');
          el.innerHTML = `<strong>${u.label}</strong><br><span class="quality-muted">${u.id} · ${u.criticality || '—'}</span>`;
          return el;
        },
      },
      {
        key: 'functionalities',
        label: 'Funcionalidades afetadas',
        type: 'text',
        width: '220px',
        wrap: true,
        render: (u) => {
          const el = document.createElement('div');
          el.className = 'quality-funcs';
          el.textContent = formatFuncs(u.functionalities);
          return el;
        },
      },
      {
        key: 'targetPct',
        label: 'Meta',
        type: 'text',
        align: 'right',
        width: '110px',
        render: (u) => {
          const el = document.createElement('div');
          const targetPct = u.targets?.lineCoveragePct;
          const targetCases = u.targets?.minTestCases;
          el.innerHTML = `${targetPct != null ? `${targetPct}%` : '—'}<br><span class="quality-muted">${targetCases ?? '—'} casos</span>`;
          return el;
        },
      },
      {
        key: 'actualPct',
        label: 'Atual',
        type: 'text',
        align: 'right',
        width: '110px',
        render: (u) => {
          const el = document.createElement('div');
          const actualPct = u.actual?.lineCoveragePct;
          const actualCases = u.actual?.testCases ?? u.testsTotal ?? 0;
          el.innerHTML = `${actualPct != null ? `${actualPct}%` : '—'}<br><span class="quality-muted">${actualCases} casos</span>`;
          return el;
        },
      },
      {
        key: 'policyOk',
        label: 'Conformidade',
        type: 'text',
        width: '160px',
        render: (u) => {
          const el = document.createElement('div');
          const policyBadge =
            u.lifecycle === 'planned'
              ? statusBadge(true, 'Planejado')
              : statusBadge(u.policyOk, u.policyLabel || (u.policyOk ? 'OK' : 'Gap'));
          const gaps =
            u.gaps?.length ?
              `<ul class="quality-gaps">${u.gaps.map((g) => `<li>${g}</li>`).join('')}</ul>`
            : '';
          el.innerHTML = `${policyBadge}${gaps}`;
          return el;
        },
      },
    ],
    rows: (units || []).map((u) => ({ id: u.id, ...u })),
    emptyText: 'Sem dados de unidades.',
  });
}

function mountHistoryGrid(host, history) {
  mountCoCeoExcelGrid(host, {
    gridId: 'quality-history-v1',
    tableTheme: COCKPIT_EXCEL_THEME,
    coCeoColumns: [
      {
        key: 'created_at',
        label: 'Data',
        type: 'text',
        width: '160px',
        sticky: true,
        render: (h) => {
          const span = document.createElement('span');
          span.textContent = new Date(h.created_at).toLocaleString('pt-BR');
          return span;
        },
      },
      { key: 'run_mode', label: 'Modo', type: 'text', width: '100px' },
      {
        key: 'status',
        label: 'Status',
        type: 'text',
        width: '110px',
        render: (h) => {
          const wrap = document.createElement('div');
          wrap.innerHTML = statusBadge(h.status === 'passed', h.status);
          return wrap;
        },
      },
      {
        key: 'passed',
        label: 'Testes',
        type: 'text',
        width: '90px',
        align: 'right',
        render: (h) => {
          const span = document.createElement('span');
          span.textContent = `${h.passed}/${h.total_tests}`;
          return span;
        },
      },
      {
        key: 'coverage_lines_pct',
        label: 'Cob. global',
        type: 'number',
        align: 'right',
        width: '100px',
        render: (h) => {
          const span = document.createElement('span');
          span.textContent = h.coverage_lines_pct != null ? `${h.coverage_lines_pct}%` : '—';
          return span;
        },
      },
      {
        key: 'impact_skipped',
        label: 'Omitidos',
        type: 'number',
        align: 'right',
        width: '90px',
        render: (h) => {
          const span = document.createElement('span');
          span.textContent = h.impact_skipped ?? '—';
          return span;
        },
      },
    ],
    rows: history.slice(0, 15).map((h, i) => ({
      id: String(h.id ?? h.created_at ?? i),
      ...h,
    })),
    emptyText: 'Execute com npm run test:regression:persist',
  });
}

export async function QualityRegressionPage(container) {
  if (!isAuthenticated() || !isGlobalSession()) {
    navigate('/login');
    return;
  }

  let data = null;
  let error = null;

  try {
    data = await apiRequest('/api/quality/regression/dashboard');
  } catch (e) {
    error = e.message || 'Falha ao carregar painel.';
  }

  const latest = data?.latest;
  const catalog = data?.catalog;
  const policyDoc = data?.coveragePolicy;
  const impact = data?.impactPlan;
  const history = data?.history || [];
  const summary = latest?.summary || {};
  const coverage = latest?.coverage || {};
  const policyCompliance = latest?.policyCompliance || {};
  const units = latest?.units || catalog?.units || [];

  const kpiCards = latest
    ? `<div class="quality-kpis">
        <div class="quality-kpi">
          <span class="quality-kpi__label">Conformidade por unidade</span>
          <strong>${policyCompliance.conformingUnits ?? 0} / ${policyCompliance.activeUnits ?? 0}</strong>
          <span class="quality-kpi__hint">Metas por funcionalidade (não % global fixo)</span>
          ${statusBadge(policyCompliance.allActiveConform, policyCompliance.allActiveConform ? 'Todas OK' : 'Gap(s)')}
        </div>
        <div class="quality-kpi">
          <span class="quality-kpi__label">Testes executados</span>
          <strong>${summary.passed ?? 0} / ${summary.total ?? 0}</strong>
          <span class="quality-kpi__hint">${summary.failed ?? 0} falha(s)</span>
        </div>
        <div class="quality-kpi">
          <span class="quality-kpi__label">Reteste parcial</span>
          <strong>${latest.impact?.skippedTests ?? 0} omitidos</strong>
          <span class="quality-kpi__hint">${latest.impact?.selectedTests ?? summary.total ?? 0} rodados</span>
        </div>
        <div class="quality-kpi">
          <span class="quality-kpi__label">Cobertura global</span>
          <strong>${coverage.lines != null ? `${Number(coverage.lines).toFixed(1)}%` : '—'}</strong>
          <span class="quality-kpi__hint">Apenas informativa</span>
        </div>
      </div>`
    : `<p class="quality-empty">Nenhum relatório ainda. Rode <code>npm run test:regression</code> na raiz do projeto.</p>`;

  const policyNote = policyDoc?.summary
    ? `<p class="quality-policy-note">${policyDoc.summary}</p>`
    : '';

  const impactBlock = impact
    ? `<section class="quality-section">
        <h2>Plano de impacto (git diff atual)</h2>
        <p class="quality-muted">Modo sugerido: <strong>${impact.mode}</strong> · ${impact.testFiles?.length ?? 0} arquivo(s) · ${impact.skippedCount ?? 0} omitido(s)</p>
      </section>`
    : '';

  const contentHtml = `
    ${error ? `<p class="quality-error">${error}</p>` : ''}
    ${!error ? kpiCards : ''}
    ${policyNote}
    ${impactBlock}
    <section class="quality-section">
      <h2>Unidades × funcionalidades × metas</h2>
      <p class="quality-muted">Edite metas em <code>tests/coverage-policy.json</code> conforme o risco de cada código.</p>
      <div id="quality-units-grid"></div>
    </section>
    <section class="quality-section">
      <h2>Histórico persistido</h2>
      <div id="quality-history-grid"></div>
    </section>
    <section class="quality-section quality-help">
      <h2>Comandos</h2>
      <ul>
        <li><code>npm run test:regression</code> — avalia testes + política por unidade</li>
        <li><code>tests/coverage-policy.json</code> — metas por criticidade e funcionalidade</li>
      </ul>
    </section>
  `;

  await renderShell(container, {
    title: 'Qualidade / Regressão',
    contentHtml,
  });

  if (!error) {
    const unitsHost = container.querySelector('#quality-units-grid');
    if (unitsHost) mountUnitsGrid(unitsHost, units);
    const historyHost = container.querySelector('#quality-history-grid');
    if (historyHost) mountHistoryGrid(historyHost, history);
  }
}
