import { trackScreenView } from './telemetry/index.js';

/** Quando o shell Solid está ativo, navegação delega ao @solidjs/router. */
let solidNavigate = null;

export function bindSolidNavigate(fn) {
  solidNavigate = fn;
}

const routes = new Map();

export function registerRoute(path, handler) {
  routes.set(path, handler);
}

function normalizePath(path) {
  if (!path) return '/login';
  const p = path.startsWith('/') ? path : `/${path}`;
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function currentPath() {
  const path = window.location.pathname || '/';
  return path === '/' ? '/login' : normalizePath(path);
}

export function navigate(path) {
  const target = normalizePath(path);
  if (solidNavigate) {
    solidNavigate(target);
    if (target === currentPath()) {
      window.dispatchEvent(new CustomEvent('coceo:route-refresh'));
    }
    return;
  }
  if (target === currentPath()) {
    dispatch();
    return;
  }
  window.history.pushState({ route: target }, '', target);
  dispatch();
}

export async function dispatch() {
  const path = currentPath();
  const loader = document.getElementById('app-loader');
  const app = document.getElementById('app');
  if (!app) return;

  const handler = routes.get(path) || routes.get('/login');
  if (!handler) {
    app.innerHTML = '<p class="empty-state">Rota não encontrada.</p>';
    return;
  }

  if (loader) loader.style.display = 'none';
  app.innerHTML = '';
  try {
    await handler(app);
    trackScreenView(path);
  } catch (err) {
    app.innerHTML = `<div class="error-banner">${err.message || 'Erro ao carregar página.'}</div>`;
  }
}

export function startRouter() {
  window.addEventListener('popstate', () => dispatch());
  dispatch();
}
