import { apiRequest } from '../api/client.js';
import { isGlobalSession } from '../auth/session.js';
import { MENU_CATALOG } from './menuCatalog.js';
import { loadUiManifest } from './uiManifest.js';

function allowedResourceKeys(matrix) {
  const set = new Set();
  for (const r of matrix?.resources || []) {
    if (r.effect === 'allow' && r.key) set.add(r.key);
  }
  return set;
}

function licensedModuleCodesFromApi(modulesPayload) {
  const codes = new Set(['CORE']);
  for (const m of modulesPayload?.modules || []) {
    const code = m.module_code || m.code;
    if (!code) continue;
    if (m.status === 'inactive') continue;
    codes.add(String(code));
  }
  return codes;
}

function ensureInvestFromScreens(licensed, allowed) {
  if (licensed.has('INVEST')) return;
  for (const key of allowed) {
    if (key.startsWith('screen.invest.')) {
      licensed.add('INVEST');
      return;
    }
  }
}

/** Quando IAM/contrato não responde (502), exibe menu cliente do catálogo embutido. */
function degradedTenantMenuFilter() {
  const licensed = new Set(MENU_CATALOG.map((m) => m.moduleCode));
  const allowed = new Set();
  for (const mod of MENU_CATALOG) {
    for (const item of mod.items) {
      if (item.resourceKey) allowed.add(item.resourceKey);
      if (item.children) {
        for (const child of item.children) {
          if (child.resourceKey) allowed.add(child.resourceKey);
        }
      }
    }
  }
  return { licensed, allowed, degraded: true };
}

/** Menu embutido (legado) — paths estáveis; não depende do MySQL. */
export function filterMenuCatalog(catalog, { global, allowed, licensed, degraded }) {
  return catalog
    .map((mod) => {
      if (!global && !degraded && licensed && !licensed.has(mod.moduleCode)) {
        return null;
      }

      const items = mod.items
        .map((item) => {
          if (item.children?.length) {
            const children = item.children.filter((child) => {
              if (child.platformOnly && !global) return false;
              if (child.clientOnly && global) return false;
              if (global || degraded) return true;
              if (!child.resourceKey) return true;
              return allowed.has(child.resourceKey);
            });
            if (!children.length) return null;
            const parentOk =
              global ||
              degraded ||
              !item.resourceKey ||
              allowed.has(item.resourceKey);
            if (!parentOk && !children.length) return null;
            return { ...item, children };
          }
          if (item.platformOnly && !global) return null;
          if (item.clientOnly && global) return null;
          if (global || degraded) return item;
          if (!item.resourceKey) return item;
          return allowed.has(item.resourceKey) ? item : null;
        })
        .filter(Boolean);

      if (!items.length) return null;
      return { ...mod, items };
    })
    .filter(Boolean);
}

async function loadEmbeddedMenu() {
  const global = isGlobalSession();
  if (global) {
    return filterMenuCatalog(MENU_CATALOG, {
      global: true,
      allowed: new Set(),
      licensed: null,
    });
  }
  let matrixOk = true;
  let modulesOk = true;
  const matrix = await apiRequest('/api/cockpit/me/access-matrix').catch(() => {
    matrixOk = false;
    return { resources: [] };
  });
  const modulesPayload = await apiRequest('/api/cockpit/me/contract-modules').catch(() => {
    modulesOk = false;
    return null;
  });

  if (!matrixOk || !modulesOk) {
    const { licensed, allowed, degraded } = degradedTenantMenuFilter();
    return filterMenuCatalog(MENU_CATALOG, {
      global: false,
      allowed,
      licensed,
      degraded,
    });
  }

  const allowed = allowedResourceKeys(matrix);
  const licensed = licensedModuleCodesFromApi(modulesPayload);
  ensureInvestFromScreens(licensed, allowed);
  return filterMenuCatalog(MENU_CATALOG, {
    global: false,
    allowed,
    licensed,
  });
}

function useDatabaseMenu() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('coceo_menu_source') === 'database';
}

function manifestTimeoutMs() {
  const n = Number(import.meta.env?.VITE_UI_MANIFEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

async function tryLoadDatabaseMenu() {
  const manifest = await Promise.race([
    loadUiManifest(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('manifest timeout')), manifestTimeoutMs());
    }),
  ]);
  if (manifest?.menu?.length) return manifest.menu;
  return null;
}

/**
 * Menu lateral: embutido (menuCatalog.js) por padrão — estável mesmo se o catálogo
 * no banco estiver desatualizado ou a API estiver lenta. Catálogo BD só com
 * localStorage coceo_menu_source=database ou VITE_MENU_SOURCE=database no build.
 */
export async function loadVisibleMenu() {
  const preferDb =
    useDatabaseMenu() || import.meta.env?.VITE_MENU_SOURCE === 'database';

  if (!preferDb) {
    return loadEmbeddedMenu();
  }

  try {
    const fromDb = await tryLoadDatabaseMenu();
    if (fromDb?.length) return fromDb;
  } catch {
    /* fallback */
  }
  return loadEmbeddedMenu();
}
