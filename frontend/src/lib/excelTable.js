/**
 * Fachada compatível com a API legada — delega ao ExcelTable oficial via coCeoExcelGrid.
 */
import {
  clearCoCeoExcelMounts,
  INVEST_EXCEL_THEME,
  legacyColumnsToCoCeo,
  mountCoCeoExcelGrids,
  registerCoCeoExcelMount,
  renderCoCeoExcelMountPoint,
} from './coCeoExcelGrid.js';

let tableSeq = 0;
const pendingShellMeta = new Map();

export function renderExcelTableShell({ caption = '', columns, tableId }) {
  const id = tableId || `excel-${++tableSeq}`;
  pendingShellMeta.set(id, { caption, columns });
  return renderCoCeoExcelMountPoint(id);
}

export function registerExcelTable(id, config) {
  const shellMeta = pendingShellMeta.get(id) || {};
  pendingShellMeta.delete(id);

  registerCoCeoExcelMount(id, {
    gridId: config.gridId || `legacy-excel-${id}`,
    caption: config.caption ?? shellMeta.caption ?? '',
    columns: config.columns ?? shellMeta.columns ?? [],
    columnKeys: config.columnKeys,
    rows: config.rows ?? [],
    emptyText: config.emptyText,
    tableTheme: config.tableTheme ?? INVEST_EXCEL_THEME,
    rowAttrs: config.rowAttrs,
    onRowClick: config.onRowClick,
    coCeoColumns: config.coCeoColumns,
    footerColumnTotals: config.footerColumnTotals,
    summaryLabels: config.summaryLabels,
    fixedLeadingColumns: config.fixedLeadingColumns,
  });
}

export function clearExcelTableRegistry() {
  clearCoCeoExcelMounts();
  pendingShellMeta.clear();
}

export function mountExcelTables(container) {
  mountCoCeoExcelGrids(container);
}

/** Monta uma tabela legada num único passo. */
export function mountExcelTable(container, { columns, rows, emptyText, rowAttrs, caption, gridId, tableTheme }) {
  const mountId = gridId || `excel-inline-${++tableSeq}`;
  registerExcelTable(mountId, { columns, rows, emptyText, rowAttrs, caption, gridId: mountId, tableTheme });
  if (container) {
    container.innerHTML = renderCoCeoExcelMountPoint(mountId);
    mountCoCeoExcelGrids(container);
  }
}

export function renderExcelTable({
  caption = '',
  columns,
  rows = [],
  emptyText = 'Sem registros.',
  rowAttrs,
  tableTheme,
}) {
  const tableId = `excel-static-${++tableSeq}`;
  registerExcelTable(tableId, { columns, rows, emptyText, rowAttrs, caption, tableTheme });
  return renderExcelTableShell({ caption, columns, tableId });
}

export { legacyColumnsToCoCeo, mountCoCeoExcelGrids, registerCoCeoExcelMount } from './coCeoExcelGrid.js';

export const renderExcelDataTableShell = renderExcelTableShell;
export const registerExcelDataTable = registerExcelTable;
export const mountExcelDataTable = mountExcelTable;
export const mountExcelDataTables = mountExcelTables;
export const clearExcelDataTableRegistry = clearExcelTableRegistry;
