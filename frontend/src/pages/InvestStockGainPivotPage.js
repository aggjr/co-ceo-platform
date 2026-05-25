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

const TABLE_ID = 'stock-gain-pivot';

function defaultFrom() {
  return '2026-01-01';
}

function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

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
  'dividendos',
  'jcp',
  'locacao_acao',
  'trade',
  'day_trade',
  'bonus',
  'outros_ganhos',
]);

function sumRowOperations(row) {
  let sum = 0;
  for (const key of ROW_TOTAL_COMPONENT_KEYS) {
    sum += Number(row[key] ?? 0);
  }
  const taxas = Number(row.taxas ?? 0);
  return Math.round((sum - taxas) * 100) / 100;
}

function buildColumns(columnLabels, columnOrder) {
  const ordered = columnOrder?.length ? columnOrder : Object.keys(columnLabels);
  const valueCols = ordered.filter(
    (k) => k !== 'ganho_aproximado' && k !== 'preco_estrito' && k !== 'cotacao_atual'
  );

  const cols = [
    {
      key: 'underlying',
      label: 'Ação',
      align: 'left',
      sortValue: (r) => r.underlying,
      filterText: (r) => r.underlying,
      cell: (r) =>
        r.underlying === 'TOTAL'
          ? '<strong>Total geral</strong>'
          : `<strong>${r.label || r.underlying}</strong>`,
    },
    {
      key: 'preco_estrito',
      label: 'Preço estrito (PM)',
      align: 'right',
      sortValue: (r) => r.preco_estrito ?? -1,
      filterText: (r) => String(r.preco_estrito ?? ''),
      cell: (r) => (r.underlying === 'TOTAL' ? '' : priceCell(r.preco_estrito)),
    },
    {
      key: 'cotacao_atual',
      label: 'Cotação atual',
      align: 'right',
      sortValue: (r) => r.cotacao_atual ?? -1,
      filterText: (r) => String(r.cotacao_atual ?? ''),
      cell: (r) => (r.underlying === 'TOTAL' ? '' : priceCell(r.cotacao_atual)),
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

  cols.push({
    key: 'ganho_aproximado',
    label: columnLabels.ganho_aproximado || 'Total',
    align: 'right',
    sortValue: (r) => Number(r.ganho_aproximado ?? sumRowOperations(r)),
    filterText: (r) => String(r.ganho_aproximado ?? sumRowOperations(r)),
    cell: (r) => {
      const v =
        r.ganho_aproximado != null && Number.isFinite(Number(r.ganho_aproximado))
          ? Number(r.ganho_aproximado)
          : sumRowOperations(r);
      return numCell(v);
    },
    cellClass: () => 'sgp-total-col',
  });

  return cols;
}

function bindPage(container) {
  const fromInput = container.querySelector('#sgp-from');
  const toInput = container.querySelector('#sgp-to');
  const reloadBtn = container.querySelector('#sgp-reload');
  const host = container.querySelector('#sgp-table-host');
  const summaryHost = container.querySelector('#sgp-summary');

  const load = async () => {
    if (!host) return;
    host.innerHTML = '<p class="muted">Calculando pivot por ação…</p>';
    clearExcelTableRegistry();

    try {
      const from = fromInput?.value || defaultFrom();
      const to = toInput?.value || defaultTo();
      const data = await apiRequest(
        `/api/invest/stock-gain-pivot?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      const pivot = data.pivot;
      const columnLabels = data.columnLabels || {};
      const columnOrder = data.columnOrder || [];

      if (summaryHost && pivot?.totals) {
        const net = Number(pivot.totals.ganho_aproximado ?? 0);
        const netCls = net > 0 ? 'sgp-up' : net < 0 ? 'sgp-down' : '';
        summaryHost.innerHTML = `<p class="muted">Período <strong>${pivot.from}</strong> a <strong>${pivot.to}</strong> — resultado total: <strong class="${netCls}">${formatBrl(net)}</strong> · taxas: <strong>${formatBrl(pivot.totals.taxas)}</strong></p>`;
      }

      const rows = [...(pivot?.rows || [])];
      if (pivot?.totals) {
        rows.push({
          ...pivot.totals,
          underlying: 'TOTAL',
          label: 'Total geral',
        });
      }

      const columns = buildColumns(columnLabels, columnOrder);
      host.innerHTML = renderExcelTableShell({
        caption: 'Resultados por ação (pivot)',
        columns,
        tableId: TABLE_ID,
      });

      registerExcelTable(TABLE_ID, {
        columns,
        rows,
        emptyText: 'Sem lançamentos no período para as ações da carteira.',
        rowAttrs: (r) => (r.underlying === 'TOTAL' ? 'class="sgp-totals-row"' : ''),
      });
      mountExcelTables(host);
    } catch (err) {
      host.innerHTML = `<div class="error-banner">${err.message || 'Erro ao carregar pivot.'}</div>`;
    }
  };

  reloadBtn?.addEventListener('click', load);
  load();
}

export async function InvestStockGainPivotPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(
    ['screen.invest.stock_gain.title'],
    { 'screen.invest.stock_gain.title': 'Resultados por ação' }
  );
  const screenTitle = t['screen.invest.stock_gain.title'];

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
      <div class="table-period-toolbar">
        <label>De <input type="date" id="sgp-from" value="${defaultFrom()}" /></label>
        <label>Até <input type="date" id="sgp-to" value="${defaultTo()}" /></label>
        <button type="button" id="sgp-reload" class="btn-entrar">Atualizar</button>
      </div>
      <div id="sgp-summary" class="table-period-summary"></div>
      <div id="sgp-table-host"><p class="muted">Carregando…</p></div>
    </div>
  `;

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
    contentHtml: content,
  });
  bindPage(container);
}
