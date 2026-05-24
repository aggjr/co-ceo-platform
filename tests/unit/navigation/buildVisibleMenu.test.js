import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../frontend/src/api/client.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../../frontend/src/auth/session.js', () => ({
  isGlobalSession: vi.fn(() => false),
}));

import { apiRequest } from '../../../frontend/src/api/client.js';
import { filterMenuCatalog, loadVisibleMenu } from '../../../frontend/src/navigation/buildVisibleMenu.js';
import { MENU_CATALOG } from '../../../frontend/src/navigation/menuCatalog.js';

describe('buildVisibleMenu', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('coceo_menu_source');
    }
  });

  it('modo degradado: API 502 ainda exibe INVEST', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('502'));
    const menu = await loadVisibleMenu();
    const invest = menu.find((m) => m.id === 'invest');
    expect(invest?.items?.length).toBeGreaterThan(0);
  });

  it('filtro degradado ignora licença mas oculta platformOnly', () => {
    const menu = filterMenuCatalog(MENU_CATALOG, {
      global: false,
      allowed: new Set(),
      licensed: new Set(['CORE']),
      degraded: true,
    });
    expect(menu.some((m) => m.id === 'invest')).toBe(true);
    const cockpit = menu.find((m) => m.id === 'cockpit');
    expect(cockpit?.items.every((i) => !String(i.path).includes('/platform'))).toBe(true);
  });
});
