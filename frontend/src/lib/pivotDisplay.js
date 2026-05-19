import { buildResultadoPivotExcelConfig } from './resultadoPivotTable.js';
import {
  clearCoCeoExcelMounts,
  legacyColumnsToCoCeo,
  mountCoCeoExcelGrids,
  registerCoCeoExcelMount,
} from './coCeoExcelGrid.js';

export { buildResultadoPivotExcelConfig } from './resultadoPivotTable.js';

export function renderPivotTable(pivot, columnLabels) {
  const cfg = buildResultadoPivotExcelConfig(pivot, columnLabels);
  clearCoCeoExcelMounts();
  registerCoCeoExcelMount(cfg.tableId, {
    gridId: `invest-resultado-${cfg.tableId}`,
    caption: cfg.caption,
    columns: cfg.columns,
    columnKeys: cfg.columnKeys,
    rows: cfg.rows,
    emptyText: cfg.emptyText,
  });
  return `<div class="portfolio-excel-section" data-coceo-excel-mount="${cfg.tableId}"></div>`;
}

export function mountPivotExcelTable(container) {
  mountCoCeoExcelGrids(container);
}
