/**
 * GridPreferences — persiste preferências de layout do grid por usuário.
 * Chave de storage: `grid_prefs_<gridId>_<userId>_<tenantId>`
 *
 * Estrutura salva:
 * {
 *   columnWidths:  { [colKey]: "120px" },
 *   columnOrder:   ["key1", "key2", ...],  // apenas colunas não-sticky
 *   sortConfig:    { key: "col", direction: "asc" | "desc" }
 * }
 *
 * Filtros de coluna não são persistidos (sempre abrir sem filtro); chave `filters` legada é removida no load.
 */
export class GridPreferences {
    constructor(gridId) {
        this.gridId = gridId;
        this.userId = this._resolveUserId();
        this.tenantId = this._resolveTenantId();
        this.storageKey = `grid_prefs_${gridId}_${this.userId}_${this.tenantId}`;
    }

    _resolveUserId() {
        // Tenta pegar o userId do token JWT, do objeto de login ou de campos expostos globalmente.
        try {
            const token = localStorage.getItem('token');
            if (token) {
                const part = token.split('.')[1] || '';
                const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
                const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
                const payload = JSON.parse(atob(padded));
                return payload.sub || payload.id || payload.userId || payload.email || payload.username || 'anon';
            }
        } catch (_) { /* ignore */ }
        try {
            const userRaw = localStorage.getItem('user');
            if (userRaw) {
                const user = JSON.parse(userRaw);
                const id = user && (user.id || user.userId || user.email || user.username);
                if (id != null && String(id).trim() !== '') return String(id);
            }
        } catch (_) { /* ignore */ }
        return localStorage.getItem('userId') || localStorage.getItem('userEmail') || 'anon';
    }

    _resolveTenantId() {
        try {
            const explicit = localStorage.getItem('currentTenantId');
            if (explicit) return String(explicit);
            const userRaw = localStorage.getItem('user');
            if (userRaw) {
                const user = JSON.parse(userRaw);
                if (user && user.tenantId != null) return String(user.tenantId);
            }
        } catch (_) { /* ignore */ }
        return 'global';
    }

    load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return {};
            const prefs = JSON.parse(raw);
            if (!prefs || typeof prefs !== 'object') return {};
            if (prefs.filters != null) {
                delete prefs.filters;
                try {
                    localStorage.setItem(this.storageKey, JSON.stringify(prefs));
                } catch (_) { /* ignore quota */ }
            }
            return prefs;
        } catch (_) {
            return {};
        }
    }

    save(prefs) {
        try {
            const current = this.load();
            localStorage.setItem(this.storageKey, JSON.stringify({ ...current, ...prefs }));
        } catch (_) { /* ignore quota errors */ }
    }

    saveColumnWidth(colKey, width) {
        const prefs = this.load();
        if (!prefs.columnWidths) prefs.columnWidths = {};
        prefs.columnWidths[colKey] = width;
        localStorage.setItem(this.storageKey, JSON.stringify(prefs));
    }

    saveColumnOrder(orderedKeys) {
        const prefs = this.load();
        prefs.columnOrder = orderedKeys;
        localStorage.setItem(this.storageKey, JSON.stringify(prefs));
    }

    saveSortConfig(sortConfig) {
        const prefs = this.load();
        const key = sortConfig && sortConfig.key ? String(sortConfig.key) : null;
        const direction = sortConfig && sortConfig.direction === 'desc' ? 'desc' : 'asc';
        prefs.sortConfig = key ? { key, direction } : { key: null, direction: 'asc' };
        localStorage.setItem(this.storageKey, JSON.stringify(prefs));
    }

    applyToColumns(columns, fixedLeadingColumns) {
        const prefs = this.load();
        const nFix = Math.max(0, Number(fixedLeadingColumns) || 0);

        // Restaurar ordem apenas das colunas móveis (após as N primeiras fixas).
        if (prefs.columnOrder && Array.isArray(prefs.columnOrder) && prefs.columnOrder.length && nFix < columns.length) {
            const head = columns.slice(0, nFix);
            const tail = columns.slice(nFix);
            const byKey = new Map(tail.map((c) => [c.key, c]));
            const orderedTail = [];
            const used = new Set();
            for (const k of prefs.columnOrder) {
                const c = byKey.get(k);
                if (c) {
                    orderedTail.push(c);
                    used.add(k);
                }
            }
            for (const c of tail) {
                if (!used.has(c.key)) orderedTail.push(c);
            }
            columns.length = 0;
            columns.push(...head, ...orderedTail);
        }

        if (prefs.columnWidths) {
            let cleaned = false;
            const cw = { ...prefs.columnWidths };
            for (const [key, val] of Object.entries(cw)) {
                const s = String(val).trim();
                if (!s) {
                    delete cw[key];
                    cleaned = true;
                    continue;
                }
                if (/vw|vh|vmin|vmax|%/i.test(s)) {
                    delete cw[key];
                    cleaned = true;
                    continue;
                }
                const pxNum = /^(\d+)\s*px$/i.exec(s);
                if (pxNum) {
                    const n = parseInt(pxNum[1], 10);
                    if (n > 2500) {
                        delete cw[key];
                        cleaned = true;
                    }
                }
            }
            if (cleaned) {
                prefs.columnWidths = Object.keys(cw).length ? cw : undefined;
                try {
                    localStorage.setItem(this.storageKey, JSON.stringify(prefs));
                } catch (_) { /* ignore */ }
            }
            columns.forEach((col) => {
                if (prefs.columnWidths && prefs.columnWidths[col.key]) {
                    col.width = prefs.columnWidths[col.key];
                }
            });
        }

        return columns;
    }
}
