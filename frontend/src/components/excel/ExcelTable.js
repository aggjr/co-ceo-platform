import { getApiBaseUrl } from '../../lib/coCeoApiConfig.js';
import { formatDateBr, normalizeToIsoDate } from '../../lib/dateFormat.js';
import { GridPreferences } from './GridPreferences.js';

/**
 * Largura em px para offsets de colunas sticky.
 * parseInt("2cm") === 2 (errado); medimos unidades CSS reais no DOM.
 */
function columnWidthToLayoutPx(widthVal, fallbackPx = 88) {
    if (widthVal == null || widthVal === '') return fallbackPx;
    const s = String(widthVal).trim();
    const pxMatch = /^(\d+(\.\d+)?)\s*px$/i.exec(s);
    if (pxMatch) return Math.max(0, Math.round(parseFloat(pxMatch[1])));
    const bare = /^(\d+(\.\d+)?)$/.exec(s);
    if (bare) return Math.max(0, Math.round(parseFloat(bare[1])));
    if (/^[\d.]+\s*(cm|mm|in|pt|pc|em|rem|%|ch|ex|vw|vh)$/i.test(s)) {
        try {
            const probe = document.createElement('div');
            probe.style.cssText =
                'position:absolute;left:-99999px;top:0;width:' +
                s +
                ';height:0;overflow:hidden;visibility:hidden;box-sizing:border-box;margin:0;padding:0;border:0';
            document.body.appendChild(probe);
            const w = probe.getBoundingClientRect().width;
            document.body.removeChild(probe);
            const rounded = Math.round(w);
            return rounded > 0 ? rounded : fallbackPx;
        } catch (_) {
            return fallbackPx;
        }
    }
    const loose = parseFloat(s);
    return Number.isFinite(loose) && loose > 0 ? Math.round(loose) : fallbackPx;
}

function dateRangePreset(op) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (op === 'this_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start, end };
    }
    if (op === 'last_month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return { start, end };
    }
    if (op === 'this_year') {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        return { start, end };
    }
    return null;
}

export class ExcelTable {
    constructor({ container, columns, projectId, endpointPrefix, onFilterChange, onSortChange, enableSelection, onSelectionChange, headerRow, footerRow, summaryLabels, onBulkEdit, onBulkDelete, enabled = true, tableTheme = null, fixedLeadingColumns = 0, gridId = null, columnWidthLimits = null, footerAggregate = null, footerColumnTotals = null }) {
        this.container = container;
        this.columns = columns;
        this.projectId = projectId;
        this.endpointPrefix = endpointPrefix; // If null, assumes client-side distinct values from passed data
        this.onFilterChange = onFilterChange;
        this.onSortChange = onSortChange;
        this.enableSelection = enableSelection !== false; // Enable by default unless explicitly disabled
        this.onSelectionChange = onSelectionChange;
        this.headerRow = headerRow; // Optional: { data: {...}, style: {...}, className: '' }
        this.footerRow = footerRow; // Optional: { data: {...}, style: {...}, className: '' }
        this.summaryLabels = summaryLabels || { total: 'Total Visualizado', selected: 'Selecionados' };
        this.onBulkEdit = onBulkEdit;
        this.onBulkDelete = onBulkDelete;
        this.enabled = enabled;
        this.fixedLeadingColumns = Math.max(0, Number(fixedLeadingColumns) || 0);
        this.tableTheme = {
            rowEvenBg: '#FFFFFF',
            rowOddBg: '#F3F4F6',
            rowHoverBg: '#EDD8BB',
            textColor: '#0f172a',
            bodyFontSize: null,
            ...(tableTheme || {})
        };
        this.API_BASE_URL = getApiBaseUrl();

        // State
        this.scrollState = { top: 0, left: 0 };
        this.currentData = []; // Store current data for local distinct calculation

        // Initialize State
        this.selection = new Set();
        this.activeFilters = {};
        this.sortConfig = { key: null, direction: 'asc' };

        // GridPreferences: persiste larguras, ordem de colunas e ordenação (não persiste filtros).
        this.gridPrefs = new GridPreferences(gridId || container.id || 'default');
        // Restaurar preferências salvas (largura + ordem)
        this.columns = this.gridPrefs.applyToColumns(this.columns, this.fixedLeadingColumns);
        const persistedPrefs = this.gridPrefs.load();
        const columnKeys = new Set(this.columns.map((c) => c.key));
        if (persistedPrefs && persistedPrefs.sortConfig && typeof persistedPrefs.sortConfig === 'object') {
            const sKey = persistedPrefs.sortConfig.key;
            const sDir = persistedPrefs.sortConfig.direction === 'desc' ? 'desc' : 'asc';
            if (sKey && columnKeys.has(sKey)) {
                this.sortConfig = { key: sKey, direction: sDir };
            }
        }

        /** Limites opcionais por chave de coluna: { code: { minPx, maxPx } } — evita larguras corrompidas no storage */
        /** Opcional: (ctx) => HTMLElement | null — totais extra no rodapé (ctx: currentData, columns, formatCurrency, originalData) */
        this.footerAggregate = typeof footerAggregate === 'function' ? footerAggregate : null;
        /** Opcional: (ctx) => Record<colKey, html> — totais alinhados sob cada coluna (linha no tbody). */
        this.footerColumnTotals =
            typeof footerColumnTotals === 'function' ? footerColumnTotals : null;

        this.columnWidthLimits = columnWidthLimits && typeof columnWidthLimits === 'object' ? columnWidthLimits : null;
        if (this.columnWidthLimits) {
            this.columns.forEach((col) => {
                const lim = this.columnWidthLimits[col.key];
                if (!lim) return;
                const px = columnWidthToLayoutPx(col.width || `${lim.minPx ?? 28}px`, lim.minPx ?? 28);
                const min = lim.minPx != null ? lim.minPx : 24;
                const max = lim.maxPx != null ? lim.maxPx : 4000;
                const clamped = Math.max(min, Math.min(max, px));
                if (clamped !== px) {
                    col.width = `${clamped}px`;
                    this.gridPrefs.saveColumnWidth(col.key, col.width);
                }
            });
        }
    }

    /**
     * Largura total da tabela em px (soma das colunas + checkbox).
     * NUNCA usar parseInt(col.width): "2cm" vira 2 e destrói o layout.
     */
    syncTableTotalWidthPx() {
        if (!this._tableEl) return;
        const selW = this.enableSelection ? 40 : 0;
        const total = this.columns.reduce(
            (s, col) => s + columnWidthToLayoutPx(col.width || '100px', 100),
            selW
        );
        this._tableEl.style.width = `${total}px`;
    }

    // Allow updating options dynamically
    // Allow updating options dynamically
    updateOptions({ enableSelection, onSelectionChange, enabled }) {
        let shouldRender = false;
        if (enableSelection !== undefined) {
            this.enableSelection = enableSelection;
            shouldRender = true;
        }
        if (onSelectionChange !== undefined) {
            this.onSelectionChange = onSelectionChange;
            // Callback change doesn't require render
        }
        if (enabled !== undefined) {
            this.enabled = enabled;
            shouldRender = true;
        }
        console.log('🛡️ SharedTable v0.2.21 - Options Updated', { enabled, enableSelection });

        if (shouldRender) this.render();
    }

    getHeaders() {
        const token = localStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    formatCurrency(value) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    }

    formatDate(dateString) {
        const br = formatDateBr(dateString);
        return br === '—' ? '-' : br;
    }

    getValueForCol(item, key) {
        if (key.startsWith('data')) return this.formatDate(item[key]);
        if (key === 'valor') return this.formatCurrency(item[key]);
        // Handle nested properties (e.g. company_name)
        // If key is mapped in columns definition, maybe use that?
        // But here we rely on the item having flat props (like income object has 'company_name' from SQL)
        if (item[key] !== undefined) return item[key];
        return '';
    }

    saveScrollPosition() {
        const wrapper = this.container.querySelector('.table-wrapper');
        if (wrapper) {
            this.scrollState = {
                top: wrapper.scrollTop,
                left: wrapper.scrollLeft
            };
        }
    }

    restoreScrollPosition() {
        const wrapper = this.container.querySelector('.table-wrapper');
        if (wrapper) {
            wrapper.scrollTop = this.scrollState.top;
            wrapper.scrollLeft = this.scrollState.left;
        }
    }

    getSelectedTotal() {
        const valorCol = this.columns.find(c => c.key === 'valor');
        if (!valorCol || this.selection.size === 0) return null;

        const selectedRows = this.currentData.filter(item => this.selection.has(item.id));
        const total = selectedRows.reduce((sum, row) => sum + (parseFloat(row.valor) || 0), 0);

        return {
            count: this.selection.size,
            total: total,
            items: selectedRows
        };
    }

    notifySelectionChange() {
        if (this.onSelectionChange) {
            const selectedTotal = this.getSelectedTotal();
            if (selectedTotal) {
                this.onSelectionChange(selectedTotal.items, this.selection);
            } else {
                this.onSelectionChange([], this.selection);
            }
        }
    }

    clearSelection() {
        this.selection.clear();
        this.notifySelectionChange();
        if (this.currentData.length > 0) {
            this.render(this.currentData);
        }
    }

    // Sync selection state with current data
    // Removes any selected IDs that no longer exist in currentData
    syncSelection() {
        if (this.selection.size === 0) return;

        const currentIds = new Set(this.currentData.map(item => item.id));
        const idsToRemove = [];

        // Find IDs in selection that don't exist in current data
        this.selection.forEach(id => {
            if (!currentIds.has(id)) {
                idsToRemove.push(id);
            }
        });

        // Remove stale IDs
        if (idsToRemove.length > 0) {
            idsToRemove.forEach(id => this.selection.delete(id));
            this.notifySelectionChange();
            this.updateFooterSummary();
        }
    }

    renderSpecialRow(rowConfig, className) {
        const tr = document.createElement('tr');
        tr.className = className;
        tr.setAttribute('data-special-row', 'true');

        // Apply custom styles
        if (rowConfig.style) {
            Object.assign(tr.style, rowConfig.style);
        }

        // Apply custom className
        if (rowConfig.className) {
            tr.classList.add(rowConfig.className);
        }

        // Add empty checkbox cell if selection is enabled
        if (this.enableSelection) {
            const tdEmpty = document.createElement('td');
            tdEmpty.style.padding = '1rem 0.44rem';
            tdEmpty.style.width = '40px';
            tr.appendChild(tdEmpty);
        }

        // Render data cells
        this.columns.forEach(col => {
            const td = document.createElement('td');
            td.style.padding = '1rem 0.44rem';
            td.style.textAlign = col.align || 'left';
            td.style.whiteSpace = 'nowrap';
            if (col.width) td.style.width = col.width;

            const value = rowConfig.data[col.key];

            if (col.type === 'currency' && value !== undefined) {
                td.textContent = this.formatCurrency(value);
                if (col.colorLogic) {
                    const num = parseFloat(value || 0);
                    let color = '';
                    if (col.colorLogic === 'blue') {
                        color = '#3B82F6';
                    } else {
                        let isPositiveColor = false;
                        if (col.colorLogic === 'inflow') isPositiveColor = num >= 0;
                        else if (col.colorLogic === 'outflow') isPositiveColor = num < 0;
                        color = isPositiveColor ? '#10B981' : '#EF4444';
                    }
                    td.style.color = color;
                    td.style.fontWeight = '600';
                }
            } else {
                td.textContent = value || '-';
            }

            tr.appendChild(td);
        });

        return tr;
    }

    applyClientSideFilter() {
        if (!this.activeFilters || Object.keys(this.activeFilters).length === 0) return;

        try {
            console.log('🔄 Applying Client-Side Filters:', JSON.stringify(this.activeFilters));
        } catch (_) {
            console.log('🔄 Applying Client-Side Filters: (objeto não serializável para log)');
        }

        try {
            this.currentData = this.currentData.filter(item => {
                return Object.entries(this.activeFilters).every(([key, filter]) => {
                    if (!filter) return true; // Safety

                    const colDef = this.columns.find(c => c.key === key);
                    const cellVal = (colDef && typeof colDef.filterText === 'function') ? colDef.filterText(item) : item[key];
                    const type = colDef ? (colDef.type || 'text') : 'text';

                    // --- Number/Currency ---
                    if (type === 'number' || type === 'currency') {
                        const cellNum = parseFloat(cellVal);
                        const isEmpty = isNaN(cellNum) || cellVal === null || cellVal === '';

                        if (isEmpty) {
                            // If filtering explicitly includes Empty (-999999), keep it
                            if (filter.numIn && filter.numIn.includes(-999999)) return true;
                            // If filtering active but Empty not selected -> Exclude
                            if ((filter.numIn && filter.numIn.length > 0) || filter.operator) return false;
                            return false;
                        }

                        const num = cellNum;

                        // List Checkbox Filter (valores podem vir como string do Set/checkbox)
                        if (filter.numIn?.length > 0) {
                            const selected = new Set(
                                filter.numIn.map((x) => (x === -999999 || x === '-999999' ? -999999 : Number(x)))
                            );
                            if (!selected.has(num)) return false;
                        }

                        // Operator Filter
                        if (filter.operator) {
                            const v1 = parseFloat(filter.val1);
                            const v2 = parseFloat(filter.val2);
                            if (isNaN(v1)) return true; // Safety

                            if (filter.operator === 'gt') return num > v1;
                            if (filter.operator === 'gte') return num >= v1;
                            if (filter.operator === 'lt') return num < v1;
                            if (filter.operator === 'lte') return num <= v1;
                            // Use tolerance for float equality
                            if (filter.operator === 'eq') return Math.abs(num - v1) < 0.001;
                            if (filter.operator === 'neq') return Math.abs(num - v1) > 0.001;
                            if (filter.operator === 'between') {
                                if (isNaN(v2)) return num >= v1;
                                return num >= v1 && num <= v2;
                            }
                        }
                        return true;
                    }

                    // --- Text ---
                    if (type === 'text') {
                        const isEmpty = !cellVal || cellVal === '';

                        if (isEmpty) {
                            if (filter.textIn && filter.textIn.includes('__NONE__')) return true;
                            if ((filter.textIn && filter.textIn.length > 0) || filter.operator) return false;
                            return false;
                        }

                        const txt = String(cellVal || '').toLowerCase();

                        // List Checkbox Filter (Set usa String; célula pode vir com tipo misto do JSON)
                        if (filter.textIn?.length > 0) {
                            const cellStr = String(cellVal);
                            const ok = filter.textIn.some((t) => String(t) === cellStr);
                            if (!ok) return false;
                        }

                        // Operator Filter
                        if (filter.operator) {
                            const v1 = String(filter.val1 || '').toLowerCase();
                            if (filter.operator === 'contains') return txt.includes(v1);
                            if (filter.operator === 'not_contains') return !txt.includes(v1);
                            if (filter.operator === 'starts_with') return txt.startsWith(v1);
                            if (filter.operator === 'ends_with') return txt.endsWith(v1);
                            if (filter.operator === 'eq') return txt === v1;
                            if (filter.operator === 'neq') return txt !== v1;
                        }
                        return true;
                    }

                    // --- Date ---
                    if (type === 'date') {
                        // CRITICAL FIX: Handle Empty Dates in Client-Side Filter
                        const isEmpty = !cellVal || cellVal === '0000-00-00' || cellVal === '';
                        if (isEmpty) {
                            // If filtering explicitly includes __EMPTY__, keep this row
                            if (filter.dateIn && filter.dateIn.includes('__EMPTY__')) return true;
                            // If filtering by dates but __EMPTY__ is NOT included -> Exclude
                            if (filter.dateIn && filter.dateIn.length > 0) return false;
                            // If using operators (eq, before, after) -> Exclude empty dates
                            if (filter.operator) return false;
                            return false; // Default exclude if filter is active but doesn't match empty
                        }

                        const dateStr = normalizeToIsoDate(cellVal);
                        if (!dateStr) return false;

                        if (filter.dateIn?.length > 0 && !filter.dateIn.includes('__NONE__')) {
                            if (!filter.dateIn.includes(dateStr)) return false;
                        }

                        if (filter.operator) {
                            const current = new Date(dateStr + 'T00:00:00').getTime();
                            if (['this_month', 'last_month', 'this_year'].includes(filter.operator)) {
                                const preset = dateRangePreset(filter.operator);
                                if (!preset) return true;
                                const start = preset.start.getTime();
                                const end = preset.end.getTime();
                                return current >= start && current <= end;
                            }

                            const v1Str = normalizeToIsoDate(filter.val1 || filter.start);
                            if (!v1Str) return true;

                            const v1 = new Date(v1Str + 'T00:00:00').getTime();

                            if (filter.operator === 'eq') return current === v1;
                            if (filter.operator === 'before') return current < v1;
                            if (filter.operator === 'after') return current > v1;
                            if (filter.operator === 'between') {
                                const v2Str = normalizeToIsoDate(filter.val2 || filter.end);
                                if (!v2Str) return current >= v1;
                                const v2 = new Date(v2Str + 'T00:00:00').getTime();
                                return current >= v1 && current <= v2;
                            }
                        }
                        return true;
                    }

                    // --- Boolean ---
                    if (type === 'boolean' || type === 'link') {
                        const val = filter.value;
                        if (val === 'all') return true;
                        const boolVal = !!cellVal;
                        if (val === 'true') return boolVal === true;
                        if (val === 'false') return boolVal === false;
                    }

                    return true;
                });
            });
        } catch (error) {
            console.error('❌ Critical Error in Client-Side Filter:', error);
            // Fallback: Show everything to avoid blank screen
            this.currentData = [...(this.originalData || [])];
        }
    }

    render(data) {
        // Update original source only if new data provided
        if (data) {
            this.originalData = Array.isArray(data) ? data.filter(item => item != null) : [];
        }

        // Ensure initialized
        if (!this.originalData) this.originalData = [];

        // Clone for modifications (filtering/sorting)
        this.currentData = [...this.originalData];

        // Apply Client-Side Filtering
        this.applyClientSideFilter();

        // Sync selection state - remove any selected IDs that no longer exist
        this.syncSelection();

        // Client Side Sort Fallback (if no server sort handler provided)
        if (!this.onSortChange && this.sortConfig.key) {
            const key = this.sortConfig.key;
            const dir = this.sortConfig.direction === 'desc' ? -1 : 1;
            const colDef = this.columns.find(c => c.key === key);
            const type = colDef ? colDef.type : 'text';

            const toSortNumber = (v) => {
                if (v == null || v === '') return 0;
                const n = Number(v);
                return Number.isFinite(n) ? n : 0;
            };

            this.currentData.sort((a, b) => {
                const valA = a[key];
                const valB = b[key];

                if (type === 'date') {
                    const dateA = new Date(valA).getTime() || 0;
                    const dateB = new Date(valB).getTime() || 0;
                    return (dateA - dateB) * dir;
                }
                if (type === 'currency' || type === 'number') {
                    return (toSortNumber(valA) - toSortNumber(valB)) * dir;
                }
                const sa = valA == null ? '' : String(valA);
                const sb = valB == null ? '' : String(valB);
                return sa.localeCompare(sb) * dir;
            });
        }

        this.saveScrollPosition();

        this.container.innerHTML = ''; // Clear
        /* Scroll só dentro do wrapper: cabeçalho thead com position:sticky precisa disto (senão o scroll é do pai e o TH rola junto). */
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.flex = '1';
        this.container.style.minHeight = '0';
        this.container.style.overflow = 'hidden';

        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        wrapper.tabIndex = 0;
        wrapper.style.overflow = 'auto';
        wrapper.style.flex = '1';
        wrapper.style.minHeight = '0';
        wrapper.style.border = '1px solid var(--color-border-light)';
        wrapper.style.borderRadius = '8px';

        // Disabled State Visuals (Moved to Table level to allow scrolling)
        // if (!this.enabled) { ... }

        // Calculate sticky offsets
        let currentLeft = 0;
        this.columns.forEach(col => {
            col._left = currentLeft;
            if (col.sticky) {
                const w = columnWidthToLayoutPx(col.width || '100px', 88);
                currentLeft += w;
            }
        });

        // Largura total explícita — necessária para table-layout:fixed responder
        // corretamente ao redimensionamento dinâmico de colunas.
        const selW = this.enableSelection ? 40 : 0;
        const totalTableWidth = this.columns.reduce(
            (s, col) => s + columnWidthToLayoutPx(col.width || '100px', 100),
            selW
        );
        const table = document.createElement('table');
        table.style.width = `${totalTableWidth}px`;
        table.style.borderCollapse = 'separate';
        table.style.borderSpacing = '0';
        table.style.fontSize = 'var(--text-table)';
        table.style.tableLayout = 'fixed';
        this._tableEl = table;  // referência para atualizar largura ao redimensionar

        // COLGROUP — necessário para table-layout:fixed funcionar corretamente
        // com redimensionamento dinâmico de colunas.
        const colgroup = document.createElement('colgroup');
        if (this.enableSelection) {
            const selCol = document.createElement('col');
            selCol.style.width = '40px';
            colgroup.appendChild(selCol);
        }
        this.columns.forEach(col => {
            const c = document.createElement('col');
            c.style.width = col.width || '100px';
            c.style.minWidth = '24px';
            col._colEl = c;   // referência para resize ao vivo
            colgroup.appendChild(c);
        });
        table.appendChild(colgroup);

        if (!this.enabled) {
            table.style.opacity = '0.6';
        }

        // Header
        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        trHead.style.backgroundColor = 'var(--color-primary)';
        trHead.style.color = 'white';
        // NOTA: NÃO colocar position:sticky no TR.
        // Sticky horizontal (left) em TH dentro de TR sticky NÃO funciona na maioria dos browsers.
        // Em vez disso, cada TH recebe position:sticky top:0 individualmente.

        trHead.innerHTML = this.renderHeaderContent();
        thead.appendChild(trHead);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');

        // Render Header Row (e.g., SALDO INICIAL)
        if (this.headerRow) {
            const trHeader = this.renderSpecialRow(this.headerRow, this.headerRow.className || 'header-row');
            tbody.appendChild(trHeader);
        }

        if (this.currentData.length === 0) {
            // ... empty state ...
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="${this.columns.length + (this.enableSelection ? 1 : 0)}" style="text-align:center; padding: 2rem; color: var(--color-text-muted);">Nenhum registro encontrado.</td>`;
            tbody.appendChild(tr);
        } else {
            this.currentData.forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.className = 'hoverable-row';
                // Linha dourada sutil entre as linhas
                tr.style.borderBottom = '1px solid rgba(218,177,119,0.25)';
                const isEven = index % 2 === 0;
                const rowBg = isEven ? this.tableTheme.rowEvenBg : this.tableTheme.rowOddBg;
                const rowHoverBg = this.tableTheme.rowHoverBg || rowBg;
                tr.style.setProperty('--row-bg', rowBg);
                tr.style.setProperty('--row-hover-bg', rowHoverBg);
                tr.style.backgroundColor = 'var(--row-bg)';

                // ... Hover listeners ...
                tr.addEventListener('mouseenter', () => {
                    tr.style.setProperty('--row-bg', rowHoverBg);
                    // Also ensure direct style is updated if needed, but var should suffice for children inheriting
                });
                tr.addEventListener('mouseleave', () => {
                    tr.style.setProperty('--row-bg', rowBg);
                });

                // Checkbox Column (Sticky?)
                if (this.enableSelection) {
                    const tdCb = document.createElement('td');
                    tdCb.style.boxSizing = 'border-box'; // Fix Width
                    tdCb.style.padding = '1rem 0.44rem';
                    tdCb.style.textAlign = 'center';
                    tdCb.style.width = '40px';

                    // Sticky Checkbox
                    tdCb.style.position = 'sticky';
                    tdCb.style.left = '0';
                    tdCb.style.zIndex = '10'; // Above normal cells, below header
                    tdCb.style.backgroundColor = 'var(--row-bg)'; // Match row bg dynamic

                    // Update currentLeft for other sticky columns
                    // This creates an issue: renderHeaderContent calcs `_left` based on COLUMNS array.
                    // Checkbox is extra. We need to offset columns by 40px if checkbox exists.

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'row-cb';
                    cb.checked = this.selection.has(item.id);
                    cb.onclick = (e) => {
                        e.stopPropagation();
                        if (!this.enabled) return;
                        if (e.target.checked) this.selection.add(item.id);
                        else this.selection.delete(item.id);
                        this.notifySelectionChange();
                        this.updateFooterSummary(); // Update Footer
                    };
                    tdCb.appendChild(cb);
                    tr.appendChild(tdCb);
                }

                this.columns.forEach((col, colIdx) => {
                    const td = document.createElement('td');
                    td.dataset.colKey = col.key;
                    td.style.boxSizing = 'border-box';
                    td.style.padding = '0.45rem 0.6rem';
                    td.style.textAlign = col.align || 'left';
                    if (col.wrap) {
                        td.style.whiteSpace = 'normal';
                        td.style.overflow = 'visible';
                        td.style.textOverflow = 'clip';
                        td.style.overflowWrap = 'anywhere';
                        td.style.wordBreak = 'break-word';
                        td.style.verticalAlign = 'top';
                    } else {
                        td.style.whiteSpace = 'nowrap';
                        td.style.overflow = 'hidden';
                        td.style.textOverflow = 'ellipsis';
                    }
                    td.style.color = this.tableTheme.textColor;
                    if (this.tableTheme.bodyFontSize) td.style.fontSize = this.tableTheme.bodyFontSize;
                    if (col.width) {
                        td.style.width = col.width;
                        if (col.sticky) {
                            td.style.minWidth = col.width;
                            td.style.maxWidth = col.width;
                        }
                    }
                    // Separador dourado sutil entre colunas (exceto última)
                    if (colIdx < this.columns.length - 1) {
                        td.style.borderRight = '1px solid rgba(218,177,119,0.18)';
                    }

                    // ALL TDs use var(--row-bg) inline so they inherit
                    // the color set on the parent <tr> (zebra + hover).
                    td.style.backgroundColor = 'var(--row-bg)';

                    if (col.sticky) {
                        td.style.position = 'sticky';
                        const checkboxOffset = this.enableSelection ? 40 : 0;
                        td.style.left = (col._left + checkboxOffset) + 'px';
                        td.style.zIndex = '5';
                        td.dataset.stickyKey = col.key; // para atualização de offset sem re-render
                    }

                    if (col.render) {
                        const content = col.render(item);
                        if (content instanceof Node) td.appendChild(content);
                        else td.innerHTML = content;
                    } else if (col.type === 'date') {
                        const dateValue = item[col.key];
                        const brDate = this.formatDate(dateValue);
                        if (!dateValue || dateValue === '0000-00-00' || brDate === '-') {
                            td.innerHTML = '<span class="text-muted">-</span>';
                        } else {
                            td.textContent = brDate;
                        }
                    } else if (col.type === 'currency') {
                        const val = item[col.key];
                        td.textContent = this.formatCurrency(val);
                        if (col.colorLogic) {
                            const num = parseFloat(val || 0);
                            let color = '';
                            if (col.colorLogic === 'blue') {
                                color = '#3B82F6';
                            } else {
                                let isPositiveColor = false;
                                if (col.colorLogic === 'inflow') isPositiveColor = num >= 0;
                                else if (col.colorLogic === 'outflow') isPositiveColor = num < 0;
                                color = isPositiveColor ? '#10B981' : '#EF4444';
                            }
                            td.style.color = color;
                            td.style.fontWeight = '600';
                        }
                    } else {
                        td.textContent = this.getValueForCol(item, col.key);
                    }
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }

        // Render Footer Row (e.g., SALDO FINAL)
        if (this.footerRow) {
            const trFooter = this.renderSpecialRow(this.footerRow, 'footer-row');
            tbody.appendChild(trFooter);
        }

        if (this.footerColumnTotals) {
            const cells = this.footerColumnTotals(this._footerTotalsContext());
            const trTotals = this.renderColumnTotalsRow(cells);
            tbody.appendChild(trTotals);
        }

        table.appendChild(tbody);
        wrapper.appendChild(table);
        this.container.appendChild(wrapper);

        // --- SUMMARY FOOTER ---
        this.renderFooterSummary();

        // Attach events, restore scroll...
        this.attachHeaderEvents(trHead);
        this.syncTableTotalWidthPx();
        this.restoreScrollPosition();
    }

    renderHeaderContent() {
        const FILTER_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" class="filter-icon" width="14" height="14"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>`;

        const headers = this.columns.map((col, colIndex) => {
            const isActive = this.activeFilters[col.key];
            // User Report: "Cor apagada". Force pure white #FFFFFF for inactive.
            const color = isActive ? 'var(--color-gold)' : '#FFFFFF';

            // Sort State (crescente / decrescente / desligado — ícone ⇅ fixo, cores indicam estado)
            const isSortKey = this.sortConfig.key === col.key;
            const isAsc = isSortKey && this.sortConfig.direction === 'asc';
            const isDesc = isSortKey && this.sortConfig.direction === 'desc';
            const arrowIdle = '#FFFFFF';
            const arrowGold = 'var(--color-gold)';
            const upFill = isAsc ? arrowGold : arrowIdle;
            const downFill = isDesc ? arrowGold : arrowIdle;
            const sortIconHtml = `<svg class="sort-pair-icon" width="12" height="10" viewBox="0 0 14 11" aria-hidden="true" style="display:block;flex-shrink:0;">
                <polygon points="3.5,2 1,7 6,7" fill="${upFill}"/>
                <polygon points="10.5,9 8,4 13,4" fill="${downFill}"/>
            </svg>`;

            // Flex Alignment Logic - Always Center Headers
            const justify = 'center';
            const labelColor = isActive ? 'var(--color-gold)' : '#FFFFFF';
            const spanStyle =
                'text-align: center; white-space: normal; overflow-wrap: anywhere; word-break: break-word; font-weight: 600; ' +
                `color: ${labelColor}; flex: 1; min-width: 0; font-size: inherit; line-height: 1.1;`;
            const containerStyle =
                'display: flex; align-items: center; justify-content: ' + justify + '; width: 100%; gap: 4px; min-width: 0;';

            // Spacer for center alignment balance
            const spacer = (col.align === 'center') ? '<div style="width: 12px; flex-shrink: 0;"></div>' : '';

            const isDraggable = this.enabled && !col.sticky && colIndex >= this.fixedLeadingColumns;
            const dragHint = col.sticky || colIndex < this.fixedLeadingColumns
                ? (this.enabled ? 'Funil para abrir filtros · alça à direita para redimensionar' : '')
                : (this.enabled ? 'Funil para abrir filtros · arraste o cabeçalho para mover coluna · alça à direita para redimensionar' : '');
            const plainLabel = col.noFilter
                ? `<span style="display:block;white-space:normal;overflow-wrap:anywhere;word-break:break-word;font-weight:600;text-align:center;line-height:1.1;">${col.label}</span>`
                : '';
            const content = col.noFilter
                ? plainLabel
                : `<div class="header-sort-trigger" data-key="${col.key}" style="${containerStyle} cursor: ${isDraggable ? 'grab' : 'default'};" title="${dragHint}">
                     ${spacer}
                     <span style="${spanStyle}">${col.label}</span>
                     <div style="display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 12px;">
                         <div class="filter-trigger" data-key="${col.key}" style="cursor: ${this.enabled ? 'pointer' : 'default'}; line-height: 0; margin-bottom: 1px;" title="Filtrar">
                             <span style="color: ${color}; opacity: 1;">
                                 <svg viewBox="0 0 24 24" fill="${color}" class="filter-icon" width="12" height="12" style="opacity: 1;display:block;"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>
                             </span>
                         </div>
                         <div class="sort-toggle" data-key="${col.key}" style="cursor: ${this.enabled ? 'pointer' : 'default'}; line-height: 1; user-select: none; display: flex; align-items: center; justify-content: center;" title="Ordenar: crescente → decrescente → desligado">
                             ${sortIconHtml}
                         </div>
                     </div>
                   </div>`;

            const w = col.width ? String(col.width).trim() : '';
            const dimLock = col.sticky && w
                ? `width: ${w}; min-width: ${w}; max-width: ${w};`
                : (w ? `width: ${w};` : 'width: auto;');

            const stickyTopBase =
                'position: sticky; top: 0; background-color: var(--color-primary); box-shadow: 0 1px 0 rgba(0,0,0,0.12);';
            const stickyZ = col.sticky
                ? `left: ${col._left + (this.enableSelection ? 40 : 0)}px; z-index: 40;`
                : 'z-index: 22;';

            const thFont = 'font-size: 0.6875rem;';
            const thPad = 'padding: 0.35rem 0.28rem;';
            return `<th ${isDraggable ? 'draggable="true"' : ''} data-col-key="${col.key}" class="${isDraggable ? 'draggable-header' : ''}" style="box-sizing: border-box; text-align: ${col.align || 'left'}; ${thPad} ${thFont} ${dimLock} vertical-align: middle; color: white; cursor: ${isDraggable ? 'move' : 'default'}; ${stickyTopBase} ${stickyZ}">${content}</th>`;
        }).join('');

        // Prepend Checkbox Header if enabled
        if (this.enableSelection) {
            const isAllSelected = this.currentData.length > 0 && this.currentData.every(item => this.selection.has(item.id));
            const checkboxHtml = `
                <th style="box-sizing: border-box; width: 40px; text-align: center; vertical-align: middle; padding: 0.42rem 0.28rem; font-size: 0.6875rem; position: sticky; top: 0; left: 0; z-index: 50; background-color: var(--color-primary); box-shadow: 0 1px 0 rgba(0,0,0,0.12);">
                    <input type="checkbox" class="select-all-cb" ${isAllSelected ? 'checked' : ''} style="cursor: ${this.enabled ? 'pointer' : 'default'}; transform: scale(1.2);" ${!this.enabled ? 'disabled' : ''}>
                </th>
            `;
            return checkboxHtml + headers;
        }
        return headers;
    }

    _footerTotalsContext() {
        return {
            currentData: this.currentData,
            originalData: this.originalData,
            columns: this.columns,
            formatCurrency: (v) => this.formatCurrency(v),
        };
    }

    renderColumnTotalsRow(cells) {
        const tr = document.createElement('tr');
        tr.className = 'excel-column-totals-row footer-row';

        if (this.enableSelection) {
            const tdCb = document.createElement('td');
            tr.appendChild(tdCb);
        }

        this.columns.forEach((col) => {
            const td = document.createElement('td');
            td.dataset.colKey = col.key;
            td.style.boxSizing = 'border-box';
            td.style.padding = '0.5rem 0.6rem';
            td.style.textAlign = col.align || 'left';
            td.style.fontWeight = '600';
            td.style.fontSize = this.tableTheme.bodyFontSize || '13px';
            td.style.color = this.tableTheme.textColor;
            if (col.width) td.style.width = col.width;

            if (col.sticky) {
                td.style.position = 'sticky';
                const checkboxOffset = this.enableSelection ? 40 : 0;
                td.style.left = (col._left + checkboxOffset) + 'px';
                td.style.zIndex = '6';
                td.style.backgroundColor = 'rgba(15, 23, 42, 0.98)';
            }

            const content = cells?.[col.key];
            td.innerHTML = content === undefined || content === null ? '' : String(content);
            tr.appendChild(td);
        });
        return tr;
    }

    syncColumnTotalsRow() {
        if (!this.footerColumnTotals) return;
        const tr = this._tableEl?.querySelector?.('tr.excel-column-totals-row');
        if (!tr) return;
        const cells = this.footerColumnTotals(this._footerTotalsContext());
        this.columns.forEach((col) => {
            const td = tr.querySelector(`td[data-col-key="${col.key}"]`);
            if (!td) return;
            const content = cells?.[col.key];
            td.innerHTML = content === undefined || content === null ? '' : String(content);
        });
    }

    renderFooterSummary() {
        const existingInfo = this.container.querySelector('.table-footer-summary');
        if (existingInfo) existingInfo.remove();

        const footer = document.createElement('div');
        footer.className = 'table-footer-summary';
        footer.style.padding = '0.75rem';
        footer.style.borderTop = '1px solid var(--color-border-light)';
        footer.style.backgroundColor = '#f9fafb';
        footer.style.display = 'flex';
        footer.style.flexDirection = 'row';
        footer.style.flexWrap = 'wrap';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.gap = '0';
        footer.style.fontSize = '0.9rem';
        footer.style.color = 'var(--color-text-secondary)';

        this.container.appendChild(footer);
        this.updateFooterSummary();
    }

    updateFooterSummary() {
        const footer = this.container.querySelector('.table-footer-summary');
        if (!footer) return;

        const totalOriginal = this.originalData ? this.originalData.length : 0;
        const totalVisualized = this.currentData.length;
        const selected = this.selection.size;

        const rawTotalLabel = String(this.summaryLabels.total || 'Total').trim();
        const totalLabelBase = rawTotalLabel.split(':')[0].trim();
        /* NBSP evita colapso do espaço entre ":" e o número no flex do rodapé */
        let totalText = `<strong>${totalLabelBase}:</strong>\u00A0${totalOriginal}`;

        // If filtered, show visualizado details
        if (totalVisualized !== totalOriginal) {
            totalText += ` <span style="font-size: 0.8em; margin-left: 8px;">(Visualizado:\u00A0${totalVisualized})</span>`;
        }

        // Calculate Selected Sum
        let selectedSumHtml = '';
        if (selected > 0) {
            const valorCol = this.columns.find(c => c.key === 'valor');
            if (valorCol) {
                const selectedItems = this.currentData.filter(item => this.selection.has(item.id));
                const sum = selectedItems.reduce((acc, item) => acc + (parseFloat(item.valor) || 0), 0);
                selectedSumHtml = `
                    <span style="font-size: 1.1rem; margin-left: 1rem; color: #4338ca;">
                        <strong>Total Selecionados (${selected}):</strong>\u00A0${this.formatCurrency(sum)}
                    </span>
                `;
            } else {
                selectedSumHtml = `
                    <span style="font-size: 1.1rem; margin-left: 1rem; color: #4338ca;">
                        <strong>Selecionados:</strong>\u00A0${selected}
                    </span>
                `;
            }
        }

        // Bulk Actions
        let bulkActionsHtml = '';
        if (selected > 0 && (this.onBulkEdit || this.onBulkDelete)) {
            bulkActionsHtml = `<div style="display: flex; gap: 8px; margin-left: 16px;">`;

            if (this.onBulkEdit) {
                bulkActionsHtml += `
                    <button id="btn-st-bulk-edit" style="background: #3B82F6; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; display: flex; align-items: center; gap: 4px;">
                        ✏️ Editar
                    </button>
                 `;
            }

            if (this.onBulkDelete) {
                bulkActionsHtml += `
                    <button id="btn-st-bulk-delete" style="background: #EF4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; display: flex; align-items: center; gap: 4px;">
                        🗑️ Excluir
                    </button>
                 `;
            }
            bulkActionsHtml += `</div>`;
        }

        footer.innerHTML = `
            <div class="excel-footer-main" style="display: flex; align-items: flex-start; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 8px 12px;">
                <div class="excel-footer-left" style="display: flex; align-items: center; flex-shrink: 0;">
                    ${totalText}
                </div>
                <div class="excel-footer-right" style="display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: flex-end; flex: 1; min-width: 0;">
                    ${selectedSumHtml}
                    ${bulkActionsHtml}
                </div>
            </div>
        `;

        const right = footer.querySelector('.excel-footer-right');
        if (this.footerAggregate && right && !this.footerColumnTotals) {
            right.querySelectorAll('.excel-footer-aggregate').forEach((n) => n.remove());
            const aggEl = this.footerAggregate(this._footerTotalsContext());
            if (aggEl) {
                aggEl.classList.add('excel-footer-aggregate');
                aggEl.style.cssText = (aggEl.style.cssText || '') + ';display:inline-flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline;font-size:12px;line-height:1.4;';
                right.appendChild(aggEl);
            }
        }

        this.syncColumnTotalsRow();

        // Attach Handlers
        if (selected > 0) {
            const btnEdit = footer.querySelector('#btn-st-bulk-edit');
            if (btnEdit && this.onBulkEdit) {
                btnEdit.onclick = (e) => { e.stopPropagation(); this.onBulkEdit(); };
            }
            const btnDelete = footer.querySelector('#btn-st-bulk-delete');
            if (btnDelete && this.onBulkDelete) {
                btnDelete.onclick = (e) => { e.stopPropagation(); this.onBulkDelete(); };
            }
        }
    }

    attachHeaderEvents(headerRow) {
        if (this.enableSelection) {
            const selectAllCb = headerRow.querySelector('.select-all-cb');
            if (selectAllCb) {
                selectAllCb.onclick = (e) => {
                    e.stopPropagation();
                    if (!this.enabled) { e.preventDefault(); return; }
                    const isChecked = e.target.checked;
                    if (isChecked) {
                        this.currentData.forEach(item => this.selection.add(item.id));
                    } else {
                        // Deselect visible items (or clear all? usually clear all visible, but here selection might be global? 
                        // For simplicity, let's treat "Select All" as "Select All on Page".
                        // If we want global, we need 'ids' logic but we only have currentData.
                        this.currentData.forEach(item => this.selection.delete(item.id));
                    }
                    this.notifySelectionChange();
                    this.render(this.currentData); // Re-render to update row checkboxes
                };
            }
        }

        headerRow.querySelectorAll('.filter-trigger').forEach(trigger => {
            trigger.onclick = (e) => {
                e.stopPropagation();
                if (!this.enabled) return;
                this.showAdvancedMenu(trigger.dataset.key, trigger);
            };
        });

        headerRow.querySelectorAll('.sort-toggle').forEach(toggle => {
            toggle.onclick = (e) => {
                e.stopPropagation();
                if (!this.enabled) return;
                const key = toggle.dataset.key;
                const col = this.columns.find(c => c.key === key);
                if (!col) return;

                // Ciclo padrão: crescente → decrescente → desligado.
                // Para campos numéricos/data/currency: decrescente → crescente → desligado.
                const isNumericOrDate = col.type === 'number' || col.type === 'currency' || col.type === 'date';
                let next;
                if (this.sortConfig.key !== key) {
                    next = { key, direction: isNumericOrDate ? 'desc' : 'asc' };
                } else if (this.sortConfig.direction === 'desc') {
                    next = { key, direction: 'asc' };
                } else if (this.sortConfig.direction === 'asc') {
                    next = { key: null, direction: 'asc' };
                } else {
                    next = { key: null, direction: 'asc' };
                }

                this.sortConfig = next;
                this.gridPrefs.saveSortConfig(this.sortConfig);
                if (this.onSortChange) this.onSortChange(this.sortConfig);
                else this.render();
            };
        });

        // Drag and Drop Logic
        const draggables = headerRow.querySelectorAll('.draggable-header');
        draggables.forEach(th => {
            th.addEventListener('dragstart', (e) => {
                if (!this.enabled) { e.preventDefault(); return; }
                if (e.target.closest && e.target.closest('.excel-col-resize-handle')) {
                    e.preventDefault();
                    return;
                }
                e.dataTransfer.setData('text/plain', th.dataset.colKey);
                e.dataTransfer.effectAllowed = 'move';
                th.style.opacity = '0.5';
            });

            th.addEventListener('dragend', (e) => {
                th.style.opacity = '1';
                draggables.forEach(h => h.style.borderLeft = ''); // Cleanup
            });

            th.addEventListener('dragover', (e) => {
                e.preventDefault(); // Necessary to allow dropping
                e.dataTransfer.dropEffect = 'move';
            });

            th.addEventListener('dragenter', (e) => {
                e.preventDefault();
                th.style.borderLeft = '4px solid var(--color-gold)';
                th.style.transition = 'border 0.2s';
            });

            th.addEventListener('dragleave', (e) => {
                th.style.borderLeft = '';
            });

            th.addEventListener('drop', (e) => {
                e.stopPropagation();
                e.preventDefault();

                const sourceKey = e.dataTransfer.getData('text/plain');
                const targetKey = th.dataset.colKey;

                if (sourceKey && targetKey && sourceKey !== targetKey) {
                    const sourceIndex = this.columns.findIndex(c => c.key === sourceKey);
                    const targetIndex = this.columns.findIndex(c => c.key === targetKey);

                    if (sourceIndex > -1 && targetIndex > -1
                        && sourceIndex >= this.fixedLeadingColumns
                        && targetIndex >= this.fixedLeadingColumns) {
                        const [removed] = this.columns.splice(sourceIndex, 1);
                        this.columns.splice(targetIndex, 0, removed);
                        // Persistir nova ordem das colunas móveis
                        const movableKeys = this.columns
                            .slice(this.fixedLeadingColumns)
                            .map(c => c.key);
                        this.gridPrefs.saveColumnOrder(movableKeys);
                        this.render();
                    }
                }
            });
        });

        const syncStickyOffsets = () => {
            let left = 0;
            this.columns.forEach(c => {
                c._left = left;
                if (c.sticky) left += columnWidthToLayoutPx(c.width || '72px', 72);
            });
            const tbody = this.container.querySelector('tbody');
            if (tbody) {
                tbody.querySelectorAll('td[data-sticky-key]').forEach(td => {
                    const sc = this.columns.find(c => c.key === td.dataset.stickyKey);
                    if (sc) td.style.left = (sc._left + (this.enableSelection ? 40 : 0)) + 'px';
                });
            }
            headerRow.querySelectorAll('th[data-col-key]').forEach(hth => {
                const sc = this.columns.find(c => c.key === hth.dataset.colKey);
                if (sc?.sticky) {
                    hth.style.left = (sc._left + (this.enableSelection ? 40 : 0)) + 'px';
                }
            });
        };

        // Column Resize — alça dedicada (evita conflito com drag HTML5 do <th> e com sort/filtro)
        const minColWidth = 28;
        const clampResizePx = (key, raw) => {
            let n = Math.max(minColWidth, Math.round(raw));
            const lim = this.columnWidthLimits?.[key];
            if (lim) {
                if (lim.minPx != null) n = Math.max(n, lim.minPx);
                if (lim.maxPx != null) n = Math.min(n, lim.maxPx);
            }
            return n;
        };
        headerRow.querySelectorAll('th[data-col-key]').forEach((th) => {
            const colKey = th.dataset.colKey;
            const col = this.columns.find(c => c.key === colKey);
            // DO NOT override position here. It is already set to 'sticky' (top: 0) in renderHeaderContent.
            // If col.sticky is true, it also has 'left' set.
            
            let handle = th.querySelector('.excel-col-resize-handle');
            if (!handle) {
                handle = document.createElement('div');
                handle.className = 'excel-col-resize-handle';
                handle.title = 'Arrastar para ajustar a largura';
                th.appendChild(handle);
            }

            handle.addEventListener('mousedown', (e) => {
                if (!this.enabled || !col) return;
                e.preventDefault();
                e.stopPropagation();

                const rect = th.getBoundingClientRect();
                const startX = e.clientX;
                const startWidth = rect.width;

                th.style.boxShadow = 'inset -3px 0 0 rgba(218,177,119,0.9)';

                const onMove = (ev) => {
                    const next = clampResizePx(colKey, startWidth + (ev.clientX - startX));
                    const lock = !!col.sticky;
                    th.style.width = `${next}px`;
                    if (lock) {
                        th.style.minWidth = `${next}px`;
                        th.style.maxWidth = `${next}px`;
                    } else {
                        th.style.minWidth = '';
                        th.style.maxWidth = '';
                    }
                    if (col._colEl) {
                        col._colEl.style.width = `${next}px`;
                        if (lock) {
                            col._colEl.style.minWidth = `${next}px`;
                            col._colEl.style.maxWidth = `${next}px`;
                        } else {
                            col._colEl.style.minWidth = '24px';
                            col._colEl.style.maxWidth = '';
                        }
                    }
                    const table = headerRow.closest('table');
                    if (table) {
                        table.querySelectorAll(`td[data-col-key="${colKey}"]`).forEach((td) => {
                            td.style.width = `${next}px`;
                            if (lock) {
                                td.style.minWidth = `${next}px`;
                                td.style.maxWidth = `${next}px`;
                            } else {
                                td.style.minWidth = '';
                                td.style.maxWidth = '';
                            }
                        });
                    }
                    col.width = `${next}px`;
                    if (col.sticky) syncStickyOffsets();
                    this.syncTableTotalWidthPx();
                };

                const onUp = (ev) => {
                    const next = clampResizePx(colKey, startWidth + (ev.clientX - startX));
                    col.width = `${next}px`;
                    const lock = !!col.sticky;
                    th.style.width = col.width;
                    if (lock) {
                        th.style.minWidth = col.width;
                        th.style.maxWidth = col.width;
                    } else {
                        th.style.minWidth = '';
                        th.style.maxWidth = '';
                    }
                    if (col._colEl) {
                        col._colEl.style.width = col.width;
                        if (lock) {
                            col._colEl.style.minWidth = col.width;
                            col._colEl.style.maxWidth = col.width;
                        } else {
                            col._colEl.style.minWidth = '24px';
                            col._colEl.style.maxWidth = '';
                        }
                    }
                    th.style.boxShadow = '';
                    const table = headerRow.closest('table');
                    if (table) {
                        table.querySelectorAll(`td[data-col-key="${colKey}"]`).forEach((td) => {
                            td.style.width = col.width;
                            if (lock) {
                                td.style.minWidth = col.width;
                                td.style.maxWidth = col.width;
                            } else {
                                td.style.minWidth = '';
                                td.style.maxWidth = '';
                            }
                        });
                    }

                    this.gridPrefs.saveColumnWidth(colKey, col.width);

                    if (col.sticky) syncStickyOffsets();
                    this.syncTableTotalWidthPx();

                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
    }

    showAdvancedMenu(colKey, target) {
        // ── Remove any existing menu ────────────────────────────────────────
        document.querySelector('.filter-dropdown')?.remove();

        const colDef   = this.columns.find(c => c.key === colKey);
        const colType  = colDef?.type || 'text';
        const colLabel = colDef?.label || colKey;

        // Working copy of the active filter for this column
        let draft = this.activeFilters[colKey] ? { ...this.activeFilters[colKey] } : {};

        // ── Helpers ──────────────────────────────────────────────────────────
        // Códigos ERP / IDs: sem separador de milhar (evita "1.062" e filtro por "1062").
        const usePlainNumber =
            colDef && (colDef.numberPlain === true || colDef.numberFormat === 'plain');
        const fmtNum = (v) => {
            if (!Number.isFinite(+v)) return v ?? '';
            if (usePlainNumber) return String(Math.trunc(Number(v)));
            return (+v).toLocaleString('pt-BR');
        };
        const fmtCur = v => this.formatCurrency ? this.formatCurrency(v) : fmtNum(v);
        const parseNum = s => {
            if (!s) return NaN;
            const clean = String(s).replace(/\./g, '').replace(',', '.');
            return parseFloat(clean);
        };

        // ── Get distinct values (client-side) ────────────────────────────────
        const getDistinct = () => {
            const raw = this.currentData.map(r => (colDef && typeof colDef.filterText === 'function') ? colDef.filterText(r) : r[colKey]);
            if (colType === 'date') {
                return [...new Set(raw.map(v => {
                    if (!v || v === '') return '__EMPTY__';
                    return normalizeToIsoDate(v) || '__EMPTY__';
                }))].sort();
            }
            if (colType === 'number' || colType === 'currency') {
                return [...new Set(raw.map((v) => {
                    if (v === null || v === undefined || v === '') return '__EMPTY__';
                    const n = Number(v);
                    return Number.isFinite(n) ? n : '__EMPTY__';
                }))].sort((a, b) => {
                    if (a === '__EMPTY__') return 1;
                    if (b === '__EMPTY__') return -1;
                    return (+a) - (+b);
                });
            }
            return [...new Set(raw.map(v => (v === null || v === undefined || v === '') ? '__EMPTY__' : v))].sort((a, b) => {
                if (a === '__EMPTY__') return 1; if (b === '__EMPTY__') return -1;
                return String(a).localeCompare(String(b), 'pt-BR');
            });
        };

        // ── Apply filter & close ──────────────────────────────────────────────
        const applyFilter = () => {
            const empty =
                !draft.operator && !draft.val1 && !draft.val2 &&
                (!draft.textIn || draft.textIn.length === 0) &&
                (!draft.numIn  || draft.numIn.length  === 0) &&
                (!draft.dateIn || draft.dateIn.length  === 0);
            if (empty) delete this.activeFilters[colKey];
            else        this.activeFilters[colKey] = draft;
            if (this.onFilterChange) this.onFilterChange(this.activeFilters);
            this.render();
            menu.remove();
        };

        // ══════════════════════════════════════════════════════════════════════
        //  BUILD MENU
        // ══════════════════════════════════════════════════════════════════════
        const menu = document.createElement('div');
        menu.className = 'filter-dropdown excel-filter-menu';
        Object.assign(menu.style, {
            position: 'fixed', zIndex: '9999',
            background: '#ffffff', border: '1px solid #c8c8c8',
            boxShadow: '0 4px 16px rgba(0,0,0,.15)',
            borderRadius: '4px', minWidth: '240px', maxWidth: '300px',
            fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '13px',
            color: '#333', userSelect: 'none',
        });
        menu.onclick = e => e.stopPropagation();

        // ── Inject shared CSS (once) ──────────────────────────────────────────
        if (!document.getElementById('excel-filter-css')) {
            const s = document.createElement('style'); s.id = 'excel-filter-css';
            s.textContent = `
              .excel-filter-menu { padding: 0; }
              .excel-filter-menu input[type="checkbox"] {
                width: 14px !important; height: 14px !important; margin: 0 !important;
                appearance: auto !important; display: inline-block !important; flex-shrink: 0;
                cursor: pointer;
              }
              .excel-filter-menu .ef-section { padding: 8px 10px; }
              .excel-filter-menu .ef-divider { height: 1px; background: #e0e0e0; margin: 0; }
              .excel-filter-menu .ef-adv-btn {
                display: flex; justify-content: space-between; align-items: center;
                padding: 6px 12px; cursor: pointer; font-size: 13px; color: #333;
              }
              .excel-filter-menu .ef-adv-btn:hover { background: #f0f0f0; }
              .excel-filter-menu .ef-search {
                width: 100%; box-sizing: border-box; padding: 5px 8px;
                border: 1px solid #ccc; border-radius: 3px; font-size: 13px;
                outline: none; margin: 4px 0; color: #333;
              }
              .excel-filter-menu .ef-search:focus { border-color: #0078d4; }
              .excel-filter-menu .ef-list {
                max-height: 220px; overflow-y: auto; border: 1px solid #ccc;
                border-radius: 3px; background: #fff; margin-top: 4px;
              }
              .excel-filter-menu .ef-list-row {
                display: flex; align-items: center; gap: 8px;
                padding: 4px 8px; cursor: pointer; min-height: 24px; font-size: 13px;
              }
              .excel-filter-menu .ef-list-row:hover { background: #f0f0f0; }
              .excel-filter-menu .ef-list-row.ef-all { font-weight: 600; border-bottom: 1px solid #eee; padding-bottom: 6px; padding-top: 6px; }
              .excel-filter-menu .ef-list-row.ef-empty-row { border-top: 1px solid #eee; color: #666; font-style: italic; }
              .excel-filter-menu .ef-footer {
                display: flex; justify-content: flex-end; gap: 8px;
                padding: 8px 10px; border-top: 1px solid #d9d9d9; background: #f3f2f1;
                border-bottom-left-radius: 4px; border-bottom-right-radius: 4px;
              }
              .excel-filter-menu .ef-btn {
                padding: 4px 16px; border: 1px solid #8a8886; border-radius: 2px;
                font-size: 13px; cursor: pointer; background: #fff; color: #333; font-weight: 500;
              }
              .excel-filter-menu .ef-btn:hover { background: #f3f2f1; }
              .excel-filter-menu .ef-btn.primary { background: #0078d4; color: #fff; border-color: #0078d4; }
              .excel-filter-menu .ef-btn.primary:hover { background: #106ebe; }
              /* Operator sub-panel */
              .excel-filter-menu .ef-op-panel {
                padding: 10px; display: flex; flex-direction: column; gap: 8px;
              }
              .excel-filter-menu .ef-op-panel select,
              .excel-filter-menu .ef-op-panel input {
                width: 100%; box-sizing: border-box; padding: 5px 8px;
                border: 1px solid #ccc; border-radius: 3px; font-size: 13px; outline: none; color: #333;
              }
              .excel-filter-menu .ef-op-panel select:focus,
              .excel-filter-menu .ef-op-panel input:focus { border-color: #0078d4; }
              .excel-filter-menu .ef-back-btn {
                display: flex; align-items: center; gap: 4px;
                color: #0078d4; cursor: pointer; font-size: 13px; margin-bottom: 4px; font-weight: 500;
              }
              .excel-filter-menu .ef-back-btn:hover { text-decoration: underline; }
              /* Date tree */
              .excel-filter-menu .ef-tree-yr { font-weight: 600; }
              .excel-filter-menu .ef-tree-mo { padding-left: 14px; }
              .excel-filter-menu .ef-tree-day { padding-left: 28px; }
              .excel-filter-menu .ef-caret { display: inline-block; width: 12px; cursor: pointer; color: #555; }
            `;
            document.head.appendChild(s);
        }

        // ── Header (column name) ──────────────────────────────────────────────
        const header = document.createElement('div');
        Object.assign(header.style, {
            padding: '6px 8px 4px', fontWeight: '700', fontSize: '11px',
            color: '#555', borderBottom: '1px solid #d9d9d9', background: '#f4f4f4',
        });
        header.textContent = colLabel.toUpperCase();
        menu.appendChild(header);

        // ══════════════════════════════════════════════════════════════════════
        //  TWO-PANEL AREA: main list  ←→  operator sub-panel
        // ══════════════════════════════════════════════════════════════════════
        const mainPanel = document.createElement('div');
        const opPanel   = document.createElement('div');
        opPanel.style.display = 'none';
        menu.appendChild(mainPanel);
        menu.appendChild(opPanel);

        const showMain = () => { mainPanel.style.display = ''; opPanel.style.display = 'none'; };
        const showOp   = () => { mainPanel.style.display = 'none'; opPanel.style.display = ''; };

        // ── Advanced operator button (top of main panel) ──────────────────────
        const typeLabel = { text: 'Texto', number: 'Número', currency: 'Número',
                            date: 'Data',  boolean: 'Valor' };
        const advBtn = document.createElement('div');
        advBtn.className = 'ef-adv-btn';
        if (colType !== 'boolean') {
            advBtn.innerHTML = `<span>Filtros de ${typeLabel[colType] || 'Texto'}</span><span>▶</span>`;
            advBtn.onclick = e => { e.stopPropagation(); buildOpPanel(); showOp(); };
            mainPanel.appendChild(advBtn);
        }

        // ── Search box ────────────────────────────────────────────────────────
        const searchBox = document.createElement('div');
        searchBox.className = 'ef-section';
        const searchInput = document.createElement('input');
        searchInput.className = 'ef-search'; searchInput.placeholder = '🔍  Pesquisar...';
        searchInput.onclick = e => e.stopPropagation();
        searchBox.appendChild(searchInput);
        mainPanel.appendChild(searchBox);

        // ── Checkbox list ─────────────────────────────────────────────────────
        const listWrap = document.createElement('div');
        listWrap.className = 'ef-section';
        listWrap.style.paddingTop = '0';
        const listEl = document.createElement('div');
        listEl.className = 'ef-list';
        listWrap.appendChild(listEl);
        mainPanel.appendChild(listWrap);

        // Build checkbox list
        const allValues = getDistinct();
        const isFiltered = (draft.textIn?.length > 0) || (draft.numIn?.length > 0) || (draft.dateIn?.length > 0);

        // Selected set
        let selSet;
        if (!isFiltered) {
            selSet = new Set(allValues);
        } else {
            const cur = draft.textIn || draft.numIn || draft.dateIn || [];
            selSet = new Set(cur.map(String));
        }

        const allRow = document.createElement('div');
        allRow.className = 'ef-list-row ef-all';
        const allCb = document.createElement('input'); allCb.type = 'checkbox';
        allCb.checked = selSet.size === allValues.length;
        allRow.appendChild(allCb);
        allRow.appendChild(document.createTextNode('(Selecionar Tudo)'));
        allRow.onclick = e => { e.stopPropagation(); allCb.checked = !allCb.checked; syncAll(allCb.checked); };
        allCb.onclick = e => { e.stopPropagation(); syncAll(allCb.checked); };
        listEl.appendChild(allRow);

        const rowMap = new Map();

        const formatVal = v => {
            if (v === '__EMPTY__') return '(Vazias)';
            if (colType === 'currency') return fmtCur(v);
            if (colType === 'number')   return fmtNum(v);
            if (colType === 'date') {
                const br = formatDateBr(v);
                return br !== '—' ? br : String(v);
            }
            return String(v);
        };

        const MONTH_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

        const makeRow = v => {
            const row = document.createElement('div');
            row.className = 'ef-list-row' + (v === '__EMPTY__' ? ' ef-empty-row' : '');
            row.dataset.val = String(v);
            const cb = document.createElement('input'); cb.type = 'checkbox';
            cb.checked = selSet.has(String(v));
            row.appendChild(cb);
            row.appendChild(document.createTextNode(formatVal(v)));
            row.onclick = e => { e.stopPropagation(); cb.checked = !cb.checked; onValToggle(String(v), cb.checked); };
            cb.onclick = e => { e.stopPropagation(); onValToggle(String(v), cb.checked); };
            rowMap.set(String(v), { row, cb });
            return row;
        };

        // Separate empty from normal values
        const normalVals = allValues.filter(v => v !== '__EMPTY__');
        const hasEmpty = allValues.includes('__EMPTY__');

        if (colType === 'date') {
            const tree = {};
            normalVals.forEach((iso) => {
                const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
                if (!m) return;
                const yy = m[1];
                const mm = Number(m[2]);
                const dd = m[3];
                if (!tree[yy]) tree[yy] = {};
                if (!tree[yy][mm]) tree[yy][mm] = [];
                tree[yy][mm].push({ iso, dd });
            });

            Object.keys(tree).sort((a, b) => Number(b) - Number(a)).forEach((yy) => {
                const yrRow = document.createElement('div');
                yrRow.className = 'ef-list-row ef-tree-yr';
                yrRow.innerHTML = `<span class="ef-caret">▸</span><span>${yy}</span>`;
                listEl.appendChild(yrRow);

                const monthsWrap = document.createElement('div');
                monthsWrap.style.display = 'none';
                listEl.appendChild(monthsWrap);

                yrRow.onclick = (e) => {
                    e.stopPropagation();
                    const open = monthsWrap.style.display !== 'none';
                    monthsWrap.style.display = open ? 'none' : '';
                    const c = yrRow.querySelector('.ef-caret');
                    if (c) c.textContent = open ? '▸' : '▾';
                };

                Object.keys(tree[yy]).sort((a, b) => Number(a) - Number(b)).forEach((mmKey) => {
                    const mm = Number(mmKey);
                    const monthRow = document.createElement('div');
                    monthRow.className = 'ef-list-row ef-tree-mo';
                    monthRow.innerHTML = `<span class="ef-caret">▸</span><span>${MONTH_PT[mm - 1] || mmKey}</span>`;
                    monthsWrap.appendChild(monthRow);

                    const daysWrap = document.createElement('div');
                    daysWrap.style.display = 'none';
                    monthsWrap.appendChild(daysWrap);
                    monthRow.onclick = (e) => {
                        e.stopPropagation();
                        const open = daysWrap.style.display !== 'none';
                        daysWrap.style.display = open ? 'none' : '';
                        const c = monthRow.querySelector('.ef-caret');
                        if (c) c.textContent = open ? '▸' : '▾';
                    };

                    tree[yy][mm].sort((a, b) => Number(a.dd) - Number(b.dd)).forEach((x) => {
                        const row = makeRow(x.iso);
                        row.classList.add('ef-tree-day');
                        // label only day (01, 02, ...)
                        if (row.childNodes[1] && row.childNodes[1].nodeType === Node.TEXT_NODE) {
                            row.childNodes[1].textContent = x.dd;
                        }
                        daysWrap.appendChild(row);
                    });
                });
            });
        } else {
            normalVals.forEach(v => listEl.appendChild(makeRow(v)));
        }
        if (hasEmpty) listEl.appendChild(makeRow('__EMPTY__'));

        const syncAll = checked => {
            rowMap.forEach(({ cb }) => { cb.checked = checked; });
            if (checked) selSet = new Set(allValues.map(String));
            else         selSet.clear();
            allCb.checked = checked;
            saveListToDraft();
        };

        const onValToggle = (val, checked) => {
            if (checked) selSet.add(val); else selSet.delete(val);
            allCb.checked = selSet.size === allValues.length;
            saveListToDraft();
        };

        const saveListToDraft = () => {
            // Clear operator-based draft
            delete draft.operator; delete draft.val1; delete draft.val2;
            const all = selSet.size === allValues.length;
            if (all) {
                delete draft.textIn; delete draft.numIn; delete draft.dateIn;
            } else if (colType === 'number' || colType === 'currency') {
                draft.numIn = [...selSet];
            } else if (colType === 'date') {
                draft.dateIn = [...selSet];
            } else {
                draft.textIn = [...selSet];
            }
        };

        // ── Search filter on list ─────────────────────────────────────────────
        searchInput.oninput = () => {
            const q = searchInput.value.toLowerCase();
            const qDigits = q.replace(/[^\d-]/g, '');
            rowMap.forEach(({ row }, val) => {
                const label = formatVal(val).toLowerCase();
                if (colType === 'number' || colType === 'currency') {
                    // Permite procurar por "1062" mesmo que a label apareça formatada como "1.062" (pt-BR).
                    const labelDigits = label.replace(/[^\d-]/g, '');
                    row.style.display = labelDigits.includes(qDigits) ? '' : 'none';
                    return;
                }
                row.style.display = label.includes(q) ? '' : 'none';
            });
        };

        /** Igualdade exata no texto da busca → atualiza selSet/draft (Enter e OK). */
        const resolveExactMatchFromSearchTrim = (raw) => {
            if (!raw) return null;
            let match = null;
            if (colType === 'number' || colType === 'currency') {
                const n = parseNum(raw);
                if (Number.isFinite(n)) {
                    match = normalVals.find((v) => Number(v) === n);
                }
            } else if (colType === 'date') {
                const iso = normalizeToIsoDate(raw);
                if (iso) match = normalVals.find((v) => String(v) === iso);
                if (match == null) match = normalVals.find((v) => String(v) === raw);
            } else {
                match =
                    normalVals.find((v) => String(v) === raw) ||
                    normalVals.find((v) => String(v).toLowerCase() === raw.toLowerCase());
            }
            return match;
        };

        /**
         * OK: colar na pesquisa só filtra a lista visualmente; selSet ainda pode ser “tudo”.
         * Antes de aplicar, grava no draft só o que está visível (intersecção) ou o match exato.
         */
        const syncDraftFromSearchBeforeOk = () => {
            const raw = searchInput.value.trim();
            if (!raw) return;

            const exact = resolveExactMatchFromSearchTrim(raw);
            if (exact != null) {
                selSet.clear();
                selSet.add(String(exact));
                rowMap.forEach(({ cb }, val) => {
                    cb.checked = val === String(exact);
                });
                allCb.checked = false;
                saveListToDraft();
                return;
            }

            const visibleSet = new Set();
            rowMap.forEach(({ row }, val) => {
                if (row.style.display !== 'none') visibleSet.add(String(val));
            });
            const narrowed = new Set([...selSet].filter((v) => visibleSet.has(String(v))));
            if (narrowed.size === 0) return;

            selSet = narrowed;
            rowMap.forEach(({ cb }, val) => {
                cb.checked = selSet.has(String(val));
            });
            allCb.checked = selSet.size === allValues.length;
            saveListToDraft();
        };

        /**
         * Enter no campo de pesquisa: mesmo fluxo do OK — match exato (ex. código) OU
         * restringir seleção às linhas visíveis após a busca e aplicar (ex. "duplex" na descrição).
         */
        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== 'NumpadEnter') return;
            e.preventDefault();
            e.stopPropagation();
            const raw = searchInput.value.trim();
            if (!raw) {
                applyFilter();
                return;
            }
            const match = resolveExactMatchFromSearchTrim(raw);
            if (match != null) {
                selSet.clear();
                selSet.add(String(match));
                rowMap.forEach(({ cb }, val) => {
                    cb.checked = val === String(match);
                });
                allCb.checked = false;
                saveListToDraft();
            } else {
                syncDraftFromSearchBeforeOk();
            }
            applyFilter();
        });

        // ══════════════════════════════════════════════════════════════════════
        //  OPERATOR SUB-PANEL
        // ══════════════════════════════════════════════════════════════════════
        const buildOpPanel = () => {
            opPanel.innerHTML = '';
            opPanel.className = 'ef-op-panel';

            const backBtn = document.createElement('div');
            backBtn.className = 'ef-back-btn';
            backBtn.innerHTML = '◀ Voltar';
            backBtn.onclick = e => { e.stopPropagation(); showMain(); };
            opPanel.appendChild(backBtn);

            const divBack = document.createElement('div'); divBack.className = 'ef-divider';
            opPanel.appendChild(divBack);

            // Operator definitions by type
            const opDefs = {
                text: [
                    { val: 'contains',     label: 'Contém...' },
                    { val: 'not_contains', label: 'Não Contém...' },
                    { val: 'starts_with',  label: 'Começa com...' },
                    { val: 'ends_with',    label: 'Termina com...' },
                    { val: 'eq',           label: 'É Igual a...' },
                    { val: 'neq',          label: 'É Diferente de...' },
                ],
                number: [
                    { val: 'eq',      label: 'É Igual a...' },
                    { val: 'neq',     label: 'É Diferente de...' },
                    { val: 'gt',      label: 'É Maior do que...' },
                    { val: 'gte',     label: 'É Maior ou Igual a...' },
                    { val: 'lt',      label: 'É Menor do que...' },
                    { val: 'lte',     label: 'É Menor ou Igual a...' },
                    { val: 'between', label: 'Está Entre...' },
                ],
                date: [
                    { val: 'eq',      label: 'É Igual a...' },
                    { val: 'before',  label: 'Antes de...' },
                    { val: 'after',   label: 'Depois de...' },
                    { val: 'between', label: 'Entre...' },
                    { val: 'this_month',  label: 'Este Mês' },
                    { val: 'last_month',  label: 'Mês Passado' },
                    { val: 'this_year',   label: 'Este Ano' },
                ],
            };
            const ops = opDefs[colType] || opDefs.text;

            const sel = document.createElement('select');
            sel.onclick = e => e.stopPropagation();
            ops.forEach(o => {
                const opt = document.createElement('option'); opt.value = o.val; opt.text = o.label;
                if ((draft.operator || (colType === 'text' ? 'contains' : 'eq')) === o.val) opt.selected = true;
                sel.appendChild(opt);
            });
            opPanel.appendChild(sel);

            const inp1 = document.createElement('input');
            inp1.type = (colType === 'date') ? 'date' : 'text';
            inp1.placeholder = colType === 'date' ? '' : (colType === 'number' || colType === 'currency') ? '0' : 'Valor...';
            inp1.value = draft.val1 || '';
            inp1.onclick = e => e.stopPropagation();
            inp1.oninput = () => {
                draft.operator = sel.value;
                draft.val1 = (colType === 'number' || colType === 'currency') ? parseNum(inp1.value) : inp1.value;
                delete draft.textIn; delete draft.numIn; delete draft.dateIn;
            };
            opPanel.appendChild(inp1);

            const inp2 = document.createElement('input');
            inp2.type = (colType === 'date') ? 'date' : 'text';
            inp2.placeholder = colType === 'date' ? '' : '0';
            inp2.value = draft.val2 || '';
            inp2.style.display = draft.operator === 'between' ? '' : 'none';
            inp2.onclick = e => e.stopPropagation();
            inp2.oninput = () => {
                draft.val2 = (colType === 'number' || colType === 'currency') ? parseNum(inp2.value) : inp2.value;
            };
            opPanel.appendChild(inp2);

            const andLabel = document.createElement('div');
            andLabel.textContent = '— e —'; andLabel.style.textAlign = 'center'; andLabel.style.color = '#555';
            andLabel.style.display = draft.operator === 'between' ? '' : 'none';
            opPanel.insertBefore(andLabel, inp2);

            sel.onchange = () => {
                draft.operator = sel.value;
                delete draft.textIn; delete draft.numIn; delete draft.dateIn;
                const isBetween = sel.value === 'between';
                inp2.style.display  = isBetween ? '' : 'none';
                andLabel.style.display = isBetween ? '' : 'none';
                // Shortcut operators (no input needed)
                if (['this_month','last_month','this_year'].includes(sel.value)) {
                    inp1.style.display = 'none'; inp2.style.display = 'none'; andLabel.style.display = 'none';
                } else {
                    inp1.style.display = '';
                }
            };
            if (['this_month','last_month','this_year'].includes(draft.operator)) inp1.style.display = 'none';
        };

        // ── Footer buttons ────────────────────────────────────────────────────
        const footer = document.createElement('div'); footer.className = 'ef-footer';

        const btnClear = document.createElement('button'); btnClear.className = 'ef-btn'; btnClear.textContent = 'Limpar';
        btnClear.onclick = e => {
            e.stopPropagation();
            delete this.activeFilters[colKey];
            if (this.onFilterChange) this.onFilterChange(this.activeFilters);
            this.render(); menu.remove();
        };

        const btnOk = document.createElement('button');
        btnOk.type = 'button';
        btnOk.className = 'ef-btn primary';
        btnOk.textContent = 'OK';
        btnOk.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            syncDraftFromSearchBeforeOk();
            applyFilter();
        };

        footer.appendChild(btnClear); footer.appendChild(btnOk);
        menu.appendChild(footer);

        // ── Position menu ─────────────────────────────────────────────────────
        document.body.appendChild(menu);
        const rect = target.getBoundingClientRect();
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let top  = rect.bottom + 2;
        let left = rect.left;
        if (left + mw > window.innerWidth  - 8) left = window.innerWidth  - mw - 8;
        if (top  + mh > window.innerHeight - 8) top  = rect.top - mh - 2;
        if (left < 8) left = 8;
        menu.style.top  = top  + 'px';
        menu.style.left = left + 'px';

        // ── Close on outside click (ignorar cliques dentro do menu → OK/Clear funcionam) ──
        const close = (ev) => {
            if (ev && menu.contains(ev.target)) return;
            menu.remove();
            document.removeEventListener('click', close, true);
        };
        setTimeout(() => document.addEventListener('click', close, true), 0);

        // Focus search
        setTimeout(() => searchInput.focus(), 50);
    }
    renderSpecialRow(rowData, className) {
        const tr = document.createElement('tr');
        if (className) tr.className = className;
        if (rowData.style) {
            Object.assign(tr.style, rowData.style);
        }

        // Checkbox spacer if selection enabled
        if (this.enableSelection) {
            const td = document.createElement('td');
            tr.appendChild(td);
        }

        this.columns.forEach(col => {
            const td = document.createElement('td');
            td.dataset.colKey = col.key;
            td.style.padding = 'var(--row-padding)';
            td.style.textAlign = col.align || 'left';
            if (col.width) td.style.width = col.width;

            // Sticky logic for special rows too?
            if (col.sticky) {
                td.style.position = 'sticky';
                const checkboxOffset = this.enableSelection ? 40 : 0;
                td.style.left = (col._left + checkboxOffset) + 'px';
                td.style.zIndex = '5';
                td.style.backgroundColor = rowData.style?.backgroundColor || '#fff';
            }

            let content = rowData.data[col.key];
            if (content === undefined) content = '';

            td.innerHTML = content;
            tr.appendChild(td);
        });
        return tr;
    }
}
