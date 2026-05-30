import '../styles/coceo-excel-table.css';
import '../styles/invest-stock-gain-pivot.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import {
  clearExcelTableRegistry,
  mountExcelTables,
  registerExcelTable,
  renderExcelTableShell,
} from '../lib/excelTable.js';
import { formatBrl } from '../lib/portfolioDisplay.js';
import { loadInvestUiContext, periodDefaults } from '../lib/investUiContext.js';

const TABLE_ID = 'stock-gain-pivot';

const REFRESH_ICON_SVG = `<svg class="header-sync-icon__svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08a5.99 5.99 0 0 1-5.65 4.13 5.99 5.99 0 0 1-5.65-4.13H4v2h7.99c4.42 0 7.99-3.58 7.99-8 0-1.74-.56-3.35-1.51-4.65l1.42-1.42L20 4v6h-6l2.65-2.65z"/></svg>`;

function numCell(v) {
  const n = Number(v ?? 0);
  const cls = n > 0 ? 'sgp-up' : n < 0 ? 'sgp-down' : '';
  return `<span class="${cls}">${formatBrl(n)}</span>`;
}

function priceCell(v) {
  if (v == null || !Number.isFinite(Number(v))) return '<span class="muted">—</span>';
  return formatBrl(Number(v));
}

/** Colunas de resultado somadas na linha (exceto PM, cotação e total). */
const ROW_TOTAL_COMPONENT_KEYS = new Set([
  'venda_call',
  'compra_call',
  'venda_put',
  'compra_put',
  'resultado_custodia',
  'dividendos',
  'jcp',
  'locacao_acao',
  'trade',
  'day_trade',
  'bonus',
  'outros_ganhos',
]);

function rowPeriodResult(row) {
  if (row.ganho_aproximado != null && Number.isFinite(Number(row.ganho_aproximado))) {
    return Number(row.ganho_aproximado);
  }
  let sum = 0;
  for (const key of ROW_TOTAL_COMPONENT_KEYS) {
    sum += Number(row[key] ?? 0);
  }
  const taxas = Number(row.taxas ?? 0);
  return Math.round((sum - taxas) * 100) / 100;
}

function buildFooterColumnTotals(totals) {
  if (!totals) return null;
  return () => {
    const cells = {
      underlying: '<strong>Total geral</strong>',
      ganho_aproximado: numCell(totals.ganho_aproximado ?? 0),
      preco_estrito: '',
      cotacao_atual: '',
    };
    for (const [key, value] of Object.entries(totals)) {
      if (key === 'underlying' || key === 'label' || key === 'ganho_aproximado') continue;
      if (key === 'preco_estrito' || key === 'cotacao_atual') continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        cells[key] = numCell(value);
      }
    }
    return cells;
  };
}

function buildColumns(columnLabels, columnOrder, uiTexts = {}) {
  const ordered = columnOrder?.length ? columnOrder : Object.keys(columnLabels);
  const valueCols = ordered.filter(
    (k) =>
      k !== 'ganho_aproximado' &&
      k !== 'preco_estrito' &&
      k !== 'cotacao_atual' &&
      k !== 'underlying'
  );

  const cols = [
    {
      key: 'underlying',
      label: uiTexts['column.invest.stock_gain.underlying'] || columnLabels.underlying || 'Ação',
      align: 'left',
      sticky: true,
      width: '108px',
      sortValue: (r) => r.underlying,
      filterText: (r) => r.underlying,
      cell: (r) => `<strong>${r.label || r.underlying}</strong>`,
    },
    {
      key: 'ganho_aproximado',
      label: columnLabels.ganho_aproximado || 'Resultado',
      align: 'right',
      sticky: true,
      width: '120px',
      sortValue: (r) => rowPeriodResult(r),
      filterText: (r) => String(rowPeriodResult(r)),
      cell: (r) => numCell(rowPeriodResult(r)),
      cellClass: () => 'sgp-total-col',
    },
    {
      key: 'preco_estrito',
      label: uiTexts['column.invest.stock_gain.preco_estrito'] || 'preco_estrito',
      align: 'right',
      sortValue: (r) => r.preco_estrito ?? -1,
      filterText: (r) => String(r.preco_estrito ?? ''),
      cell: (r) => priceCell(r.preco_estrito),
    },
    {
      key: 'cotacao_atual',
      label: uiTexts['column.invest.stock_gain.cotacao_atual'] || 'cotacao_atual',
      align: 'right',
      sortValue: (r) => r.cotacao_atual ?? -1,
      filterText: (r) => String(r.cotacao_atual ?? ''),
      cell: (r) => priceCell(r.cotacao_atual),
    },
  ];

  for (const key of valueCols) {
    cols.push({
      key,
      label: columnLabels[key] || key,
      align: 'right',
      sortValue: (r) => Number(r[key] ?? 0),
      filterText: (r) => String(r[key] ?? 0),
      cell: (r) => numCell(r[key]),
    });
  }

  return cols;
}

function bindPage(container, initialBounds, uiTexts) {
  let bounds = initialBounds;
  const fromInput = container.querySelector('#sgp-from');
  const toInput = container.querySelector('#sgp-to');
  const reloadBtn = container.querySelector('#sgp-reload');
  const recalcBtn = container.querySelector('#sgp-recalc');
  const host = container.querySelector('#sgp-table-host');
  const summaryHost = container.querySelector('#sgp-summary');

  const setRecalcLoading = (loading) => {
    recalcBtn?.classList.toggle('btn-header-icon-sync--loading', loading);
    if (loading) {
      recalcBtn?.setAttribute('aria-busy', 'true');
      recalcBtn?.setAttribute('disabled', 'disabled');
    } else {
      recalcBtn?.removeAttribute('aria-busy');
      recalcBtn?.removeAttribute('disabled');
    }
  };

  const load = async ({ recalculate = false } = {}) => {
    if (!host) return;
    if (recalculate) setRecalcLoading(true);
    host.innerHTML = '<p class="muted">Calculando pivot por ação…</p>';
    clearExcelTableRegistry();

    try {
      const from = (fromInput?.value || bounds.defaultFrom).slice(0, 10);
      const toClamped = (toInput?.value || bounds.today).slice(0, 10);
      const recalcQ = recalculate ? '&recalculate=1' : '';
      const data = await apiRequest(
        `/api/invest/stock-gain-pivot?from=${encodeURIComponent(from)}&to=${encodeURIComponent(toClamped)}${recalcQ}`
      );
      if (data?.periodBounds) bounds = periodDefaults(data.periodBounds);
      const pivot = data.pivot;
      const columnLabels = data.columnLabels || {};
      const columnOrder = data.columnOrder || [];

      if (summaryHost && pivot?.totals) {
        const net = Number(pivot.totals.ganho_aproximado ?? 0);
        const netCls = net > 0 ? 'sgp-up' : net < 0 ? 'sgp-down' : '';
        const recalcNote =
          data.recalculated && data.recalculatedAt
            ? ` · recalculado ${new Date(data.recalculatedAt).toLocaleString('pt-BR')}`
            : '';
        summaryHost.innerHTML = `<p class="muted">Período <strong>${pivot.from}</strong> a <strong>${pivot.to}</strong> — resultado total: <strong class="${netCls}">${formatBrl(net)}</strong> · taxas: <strong>${formatBrl(pivot.totals.taxas)}</strong>${recalcNote}</p>`;
      }

      const rows = [...(pivot?.rows || [])];
      const columns = buildColumns(columnLabels, columnOrder, uiTexts);
      host.innerHTML = renderExcelTableShell({
        caption: 'Resultados por ação (pivot)',
        columns,
        tableId: TABLE_ID,
      });

      registerExcelTable(TABLE_ID, {
        columns,
        rows,
        emptyText: 'Sem lançamentos no período para as ações da carteira.',
        footerColumnTotals: buildFooterColumnTotals(pivot?.totals),
        summaryLabels: { total: 'Linhas', selected: '' },
        fixedLeadingColumns: 2,
      });
      mountExcelTables(host);
    } catch (err) {
      host.innerHTML = `<div class="error-banner">${err.message || 'Erro ao carregar pivot.'}</div>`;
    } finally {
      if (recalculate) setRecalcLoading(false);
    }
  };

  reloadBtn?.addEventListener('click', () => load({ recalculate: false }));
  recalcBtn?.addEventListener('click', () => load({ recalculate: true }));
  load({ recalculate: false });
}

export async function InvestStockGainPivotPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts([
    'screen.invest.stock_gain.title',
    'label.common.period_from',
    'label.common.period_to',
    'column.invest.stock_gain.underlying',
    'column.invest.stock_gain.preco_estrito',
    'column.invest.stock_gain.cotacao_atual',
  ]);
  const screenTitle = t['screen.invest.stock_gain.title'];
  const uiCtx = await loadInvestUiContext();
  const bounds = periodDefaults(uiCtx);

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
      contentHtml: `
        <div class="card">
          <h2 style="font-size:16px">${screenTitle}</h2>
          <p class="muted">Personifique o titular da holding para ver o pivot de ganhos.</p>
        </div>
      `,
    });
    return;
  }

  const content = `
    <div class="card sgp-page invest-table-card">
      <div class="table-period-toolbar sgp-toolbar">
        <label>${t['label.common.period_from']} <input type="date" id="sgp-from" value="${bounds.defaultFrom}" min="${bounds.periodMin}" /></label>
        <label>${t['label.common.period_to']} <input type="date" id="sgp-to" value="${bounds.today}" min="${bounds.periodMin}" max="${bounds.today}" /></label>
        <button type="button" id="sgp-reload" class="btn btn-secondary btn-sm">Aplicar período</button>
        <button
          type="button"
          id="sgp-recalc"
          class="btn-header-icon-sync sgp-recalc-btn"
          title="Recalcular lucros e prejuízos por ação (após conciliação)"
          aria-label="Recalcular lucros e prejuízos por ação"
        >${REFRESH_ICON_SVG}</button>
        <span class="muted sgp-recalc-hint">Use após conciliar notas — relê o livro e atualiza o pivot.</span>
      </div>
      <div id="sgp-summary" class="table-period-summary"></div>
      <div id="sgp-table-host"><p class="muted">Carregando…</p></div>
    </div>
  `;

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
    contentHtml: content,
  });
  bindPage(container, bounds, t);
}
