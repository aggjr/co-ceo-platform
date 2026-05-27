/**
 * Adaptador do ExcelTable oficial (coceo_software_template).
 * Fonte: C:\co_ceo\coceo_software_template\src\components\ExcelTable.js
 */
import { ExcelTable } from '../components/excel/ExcelTable.js';

/** Hover de linha — mesma cor do CASH (catálogo / auditoria / git): #edd8bb */
export const CASH_ROW_HOVER_BG = '#edd8bb';

export const INVEST_EXCEL_THEME = {
  rowEvenBg: 'rgba(15, 23, 42, 0.92)',
  rowOddBg: 'rgba(30, 41, 59, 0.88)',
  rowHoverBg: CASH_ROW_HOVER_BG,
  textColor: '#e2e8f0',
  bodyFontSize: '13px',
};

export const COCKPIT_EXCEL_THEME = {
  rowEvenBg: '#ffffff',
  rowOddBg: '#f8fafc',
  rowHoverBg: '#eef2f7',
  textColor: '#0f172a',
  bodyFontSize: '13px',
};

const mountRegistry = new Map();

export function clearCoCeoExcelMounts() {
  mountRegistry.clear();
}

export function registerCoCeoExcelMount(id, config) {
  mountRegistry.set(id, config);
}

function parseRowClass(rowAttrs, row) {
  if (!rowAttrs) return '';
  const raw = typeof rowAttrs === 'function' ? rowAttrs(row) : rowAttrs;
  const m = String(raw || '').match(/class="([^"]+)"/);
  return m ? m[1] : '';
}

/** Converte colunas legadas (cell/sortValue) para o ExcelTable oficial. */
export function legacyColumnsToCoCeo(legacyCols, keys) {
  return legacyCols.map((col, i) => {
    const key = keys?.[i] || col.key || `col_${i}`;
    const label = String(col.label || '');
    let type = col.type;
    if (!type) {
      if (col.align === 'right' && /preço|cotação|ganho|total|qtd|valor|meta|atual|taxa/i.test(label)) {
        type = /qtd|casos|omitidos|testes/i.test(label) ? 'number' : 'currency';
      } else if (col.align === 'right') {
        type = 'number';
      } else {
        type = 'text';
      }
    }
    return {
      key,
      label: col.label,
      type,
      align: col.align || (type === 'currency' || type === 'number' ? 'right' : 'left'),
      width: col.width || (type === 'currency' ? '112px' : '128px'),
      sticky: Boolean(col.sticky),
      render: col.render
        ? col.render
        : col.cell
          ? (row) => {
              const wrap = document.createElement('div');
              wrap.innerHTML = col.cell(row);
              if (col.cellClass) {
                const cls = col.cellClass(row);
                if (cls) wrap.className = cls;
              }
              return wrap;
            }
          : undefined,
    };
  });
}

function applyRowHooks(host, rows, { rowClass, onRowClick }) {
  if (!rowClass && !onRowClick) return;
  const trs = host.querySelectorAll('.table-wrapper tbody tr');
  trs.forEach((tr, i) => {
    const row = rows[i];
    if (!row) return;
    const cls = rowClass?.(row);
    if (cls) tr.className = `${tr.className} ${cls}`.trim();
    if (onRowClick) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => onRowClick(row, tr));
    }
  });
}

function mountGridHost(parent, {
  gridId,
  columns,
  rows,
  emptyText,
  tableTheme,
  rowClass,
  onRowClick,
  footerAggregate,
  footerColumnTotals,
  summaryLabels,
  fixedLeadingColumns: fixedLeadingColumnsOpt,
}) {
  const host = document.createElement('div');
  host.className = 'coceo-excel-grid-host';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.minHeight = rows.length ? '180px' : '64px';
  host.style.flex = '1';
  parent.appendChild(host);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.padding = '12px 0';
    empty.textContent = emptyText || 'Sem registros.';
    host.appendChild(empty);
    return null;
  }

  const data = rows.map((row, i) => ({
    id: String(row.id ?? row.ticker ?? row.underlying ?? row.label ?? row.email ?? `row-${i}`),
    ...row,
  }));

  const stickyCount = columns.filter((c) => c.sticky).length;
  const fixedLeadingColumns =
    fixedLeadingColumnsOpt != null
      ? Math.max(0, Number(fixedLeadingColumnsOpt) || 0)
      : stickyCount > 0
        ? stickyCount
        : 0;

  const table = new ExcelTable({
    container: host,
    columns,
    gridId,
    projectId: 0,
    endpointPrefix: null,
    enableSelection: false,
    fixedLeadingColumns,
    tableTheme: tableTheme || INVEST_EXCEL_THEME,
    summaryLabels: summaryLabels || { total: 'Linhas', selected: '' },
    footerAggregate: footerAggregate || null,
    footerColumnTotals: footerColumnTotals || null,
  });
  table.render(data);
  applyRowHooks(host, data, { rowClass, onRowClick });
  return table;
}

/** Monta grid diretamente em um container (sem registry). */
export function mountCoCeoExcelGrid(container, config) {
  if (!container) return null;
  container.innerHTML = '';
  if (config.caption) {
    const cap = document.createElement('h3');
    cap.className = 'excel-table-caption';
    cap.innerHTML = config.caption;
    container.appendChild(cap);
  }
  const wrap = document.createElement('div');
  wrap.className = 'coceo-excel-mount-body';
  container.appendChild(wrap);

  const columns =
    config.coCeoColumns ||
    legacyColumnsToCoCeo(config.columns || [], config.columnKeys);

  const rowClass =
    config.rowClass ||
    (config.rowAttrs
      ? (row) => parseRowClass(config.rowAttrs, row)
      : undefined);

  return mountGridHost(wrap, {
    gridId: config.gridId || `coceo-${Date.now()}`,
    columns,
    rows: config.rows || [],
    emptyText: config.emptyText,
    tableTheme: config.tableTheme,
    rowClass,
    onRowClick: config.onRowClick,
    footerAggregate: config.footerAggregate,
    footerColumnTotals: config.footerColumnTotals,
    summaryLabels: config.summaryLabels,
    fixedLeadingColumns: config.fixedLeadingColumns,
  });
}

export function mountCoCeoExcelGrids(root) {
  if (!root) return;
  root.querySelectorAll('[data-coceo-excel-mount]').forEach((section) => {
    const id = section.dataset.coceoExcelMount;
    const cfg = mountRegistry.get(id);
    if (!cfg) return;

    section.innerHTML = '';
    if (cfg.caption) {
      const cap = document.createElement('h3');
      cap.className = 'excel-table-caption';
      cap.innerHTML = cfg.caption;
      section.appendChild(cap);
    }

    const columns =
      cfg.coCeoColumns ||
      legacyColumnsToCoCeo(cfg.columns || [], cfg.columnKeys);

    const rowClass =
      cfg.rowClass ||
      (cfg.rowAttrs ? (row) => parseRowClass(cfg.rowAttrs, row) : undefined);

    mountGridHost(section, {
      gridId: cfg.gridId || `coceo-${id}`,
      columns,
      rows: cfg.rows || [],
      emptyText: cfg.emptyText,
      tableTheme: cfg.tableTheme,
      rowClass,
      onRowClick: cfg.onRowClick,
      footerAggregate: cfg.footerAggregate,
      footerColumnTotals: cfg.footerColumnTotals,
      summaryLabels: cfg.summaryLabels,
      fixedLeadingColumns: cfg.fixedLeadingColumns,
    });
  });
}

/** HTML + registry para fluxo render → register → mount. */
export function renderCoCeoExcelMountPoint(mountId, { sectionClass = 'portfolio-excel-section' } = {}) {
  return `<section class="${sectionClass}" data-coceo-excel-mount="${mountId}"></section>`;
}
