import { apiRequest } from '../api/client.js';
import { isGlobalSession } from '../auth/session.js';
import { MENU_CATALOG } from './menuCatalog.js';

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

/** INVEST no menu se o contrato licencia o módulo ou a matriz libera alguma tela INVEST. */
function ensureInvestFromScreens(licensed, allowed) {
  if (licensed.has('INVEST')) return;
  for (const key of allowed) {
    if (key.startsWith('screen.invest.')) {
      licensed.add('INVEST');
      return;
    }
  }
}

export function filterMenuCatalog(catalog, { global, allowed, licensed }) {
  return catalog
    .map((mod) => {
      if (!global && licensed && !licensed.has(mod.moduleCode)) {
        return null;
      }

      const items = mod.items.filter((item) => {
        if (item.platformOnly && !global) return false;
        if (item.clientOnly && global) return false;
        if (global) return true;
        if (!item.resourceKey) return true;
        return allowed.has(item.resourceKey);
      });

      if (!items.length) return null;
      return { ...mod, items };
    })
    .filter(Boolean);
}

export async function loadVisibleMenu() {
  const global = isGlobalSession();

  if (global) {
    return filterMenuCatalog(MENU_CATALOG, {
      global: true,
      allowed: new Set(),
      licensed: null,
    });
  }

  const matrix = await apiRequest('/api/cockpit/me/access-matrix').catch(() => ({
    resources: [],
  }));
  const allowed = allowedResourceKeys(matrix);

  const modulesPayload = await apiRequest('/api/cockpit/me/contract-modules').catch(
    () => null
  );
  let licensed = licensedModuleCodesFromApi(modulesPayload);
  ensureInvestFromScreens(licensed, allowed);

  return filterMenuCatalog(MENU_CATALOG, {
    global: false,
    allowed,
    licensed,
  });
}
