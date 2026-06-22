import '../styles/coceo-excel-table.css';
import '../styles/invest-auditoria-geral.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { formatDateBr } from '../lib/dateFormat.js';
import { formatBrl } from '../lib/portfolioDisplay.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { loadInvestUiContext, periodDefaults } from '../lib/investUiContext.js';

const REFRESH_ICON = `<svg class="header-sync-icon__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatQty(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return '—';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

function formatCell(col, cell) {
  if (!cell) return '—';
  if (col.kind === 'text' || col.kind === 'status') {
    const text = String(cell.text ?? '').trim();
    if (!text) return '—';
    return escapeHtml(text);
  }
  if (col.kind === 'count') {
    const n = Number(cell.value ?? 0);
    if (!Number.isFinite(n) || n === 0) return '—';
    return String(n);
  }
  const v = cell.value;
  if (col.kind === 'qty') return formatQty(v);
  if (col.kind === 'patrimony' || col.kind === 'cash' || col.kind === 'transit' || col.kind === 'value') {
    if (v == null || !Number.isFinite(Number(v)) || Math.abs(Number(v)) < 0.005) return '—';
    return formatBrl(Number(v));
  }
  return escapeHtml(String(v ?? ''));
}

function statusClass(col, cell) {
  if (col.kind !== 'status' || !cell?.text) return '';
  const t = String(cell.text);
  if (t === 'Erro') return ' audit-geral-td--status-error';
  if (t === 'Atenção') return ' audit-geral-td--status-warn';
  if (t === 'OK') return ' audit-geral-td--status-ok';
  return '';
}

function renderMatrixTable(data) {
  const columns = data.columns || [];
  const rows = data.rows || [];
  if (!rows.length) {
    return '<p class="muted">Nenhum dia útil no período selecionado.</p>';
  }

  const head = columns
    .map((col) => {
      const sticky = col.sticky ? ' audit-geral-th--sticky' : '';
      const kind = col.kind ? ` audit-geral-th--${col.kind}` : '';
      return `<th class="audit-geral-th${sticky}${kind}" title="${escapeHtml(col.label)}">${escapeHtml(col.label)}</th>`;
    })
    .join('');

  const body = rows
    .map((row) => {
      const tds = columns
        .map((col) => {
          if (col.key === 'date') {
            return `<td class="audit-geral-td audit-geral-td--date audit-geral-td--sticky">${escapeHtml(formatDateBr(row.date))}</td>`;
          }
          const cell = row.cells?.[col.key];
          const changed = cell?.changed ? ' audit-geral-td--changed' : '';
          const isTextCol = col.kind === 'text' || col.kind === 'status';
          const num =
            col.kind === 'qty' || col.kind === 'count'
              ? ' num qty'
              : !isTextCol
                ? ' num'
                : '';
          const sticky = col.sticky ? ' audit-geral-td--sticky' : '';
          const textKind = col.kind === 'text' ? ' audit-geral-td--text' : '';
          const title =
            isTextCol && cell?.text
              ? ` title="${escapeHtml(String(cell.text))}"`
              : '';
          return `<td class="audit-geral-td${num}${sticky}${textKind}${statusClass(col, cell)}${changed}"${title}>${formatCell(col, cell)}</td>`;
        })
        .join('');
      return `<tr class="audit-geral-row">${tds}</tr>`;
    })
    .join('');

  return `
    <div class="audit-geral-meta muted">
      ${rows.length} dia(s) úteis · ${(data.tickers || []).length} ativo(s) · fonte: ${escapeHtml(data.dataSource || '—')}
    </div>
    <div class="excel-table-wrap audit-geral-wrap">
      <table class="excel-table audit-geral-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export async function InvestAuditoriaGeralPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }
  if (isGlobalSession()) {
    navigate('/cockpit');
    return;
  }

  const ctx = await loadInvestUiContext();
  const bounds = periodDefaults(ctx);
  const t = await getPageTexts([
    'screen.invest.auditoria_geral.title',
    'screen.invest.auditoria_geral.legend',
    'label.common.period_from',
    'label.common.period_to',
  ]);

  const screenTitle = t['screen.invest.auditoria_geral.title'] || 'Auditoria Geral';
  const legend =
    t['screen.invest.auditoria_geral.legend'] ||
    'Células douradas: valor alterou em relação ao dia útil anterior.';

  renderShell(container, {
    title: screenTitle,
    breadcrumbs: [{ label: 'INVEST', path: '/invest' }, { label: screenTitle }],
    headerActions: `
      <label class="audit-geral-filter">${t['label.common.period_from'] || 'De'}
        <input type="date" id="audit-from" min="${bounds.periodMin}" max="${bounds.today}" value="${bounds.defaultFrom}" />
      </label>
      <label class="audit-geral-filter">${t['label.common.period_to'] || 'Até'}
        <input type="date" id="audit-to" min="${bounds.periodMin}" max="${bounds.today}" value="${bounds.today}" />
      </label>
      <button type="button" class="btn btn-secondary btn-header-icon-sync" id="audit-reload" title="Recarregar">${REFRESH_ICON}</button>
    `,
    content: `
      <div class="audit-geral-page">
        <p class="audit-geral-legend">${escapeHtml(legend)}</p>
        <div id="audit-matrix-host"><p class="muted">Carregando matriz...</p></div>
      </div>
    `,
  });

  const host = container.querySelector('#audit-matrix-host');
  const fromInput = container.querySelector('#audit-from');
  const toInput = container.querySelector('#audit-to');
  const reloadBtn = container.querySelector('#audit-reload');

  const load = async () => {
    if (!host) return;
    reloadBtn?.classList.add('btn-header-icon-sync--loading');
    host.innerHTML = '<p class="muted">Montando matriz diária...</p>';
    try {
      const from = fromInput?.value || bounds.defaultFrom;
      const to = toInput?.value || bounds.today;
      const data = await apiRequest(
        `/api/invest/general-audit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (data?.periodBounds) {
        const pb = periodDefaults(data.periodBounds);
        if (fromInput) {
          fromInput.min = pb.periodMin;
          fromInput.max = pb.today;
        }
        if (toInput) {
          toInput.min = pb.periodMin;
          toInput.max = pb.today;
        }
      }
      host.innerHTML = renderMatrixTable(data);
    } catch (err) {
      host.innerHTML = `<p class="error">${escapeHtml(err?.message || String(err))}</p>`;
    } finally {
      reloadBtn?.classList.remove('btn-header-icon-sync--loading');
    }
  };

  reloadBtn?.addEventListener('click', load);
  fromInput?.addEventListener('change', load);
  toInput?.addEventListener('change', load);
  await load();
}
