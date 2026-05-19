const TOKEN_KEY = 'co_ceo_session';
const IMPERSONATION_KEY = 'co_ceo_impersonation_session';
const USER_KEY = 'co_ceo_user';
const HANDOFF_PREFIX = 'co_ceo_imp_handoff_';
const IMPERSONATOR_META_KEY = 'co_ceo_impersonator_meta';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getImpersonationToken() {
  return sessionStorage.getItem(IMPERSONATION_KEY);
}

export function setImpersonationToken(token) {
  sessionStorage.setItem(IMPERSONATION_KEY, token);
}

/**
 * Nova aba não compartilha sessionStorage — handoff via localStorage + query _imp.
 * Chamar no boot, antes do router.
 */
export function consumeImpersonationHandoff() {
  const params = new URLSearchParams(window.location.search);
  const handoffId = params.get('_imp');
  if (!handoffId) return false;

  const key = `${HANDOFF_PREFIX}${handoffId}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    window.history.replaceState(null, '', window.location.pathname);
    return false;
  }

  let token = raw;
  let impersonator = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.token) {
      token = parsed.token;
      impersonator = parsed.impersonator ?? null;
    }
  } catch {
    /* handoff legado: só o JWT em string */
  }

  sessionStorage.setItem(IMPERSONATION_KEY, token);
  if (impersonator) {
    sessionStorage.setItem(IMPERSONATOR_META_KEY, JSON.stringify(impersonator));
  }
  localStorage.removeItem(key);

  window.history.replaceState(null, '', window.location.pathname);
  return true;
}

export function getImpersonatorMeta() {
  const raw = sessionStorage.getItem(IMPERSONATOR_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Abre Cockpit cliente em nova aba com sessão emulada (sem afetar a aba atual). */
export function openImpersonationTab(token, impersonatorMeta) {
  const handoffId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `imp-${Date.now()}`;
  localStorage.setItem(
    `${HANDOFF_PREFIX}${handoffId}`,
    JSON.stringify({ token, impersonator: impersonatorMeta ?? null })
  );
  const url = `${window.location.origin}/cockpit?_imp=${encodeURIComponent(handoffId)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function clearImpersonationToken() {
  sessionStorage.removeItem(IMPERSONATION_KEY);
}

export function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  clearToken();
  clearImpersonationToken();
  sessionStorage.removeItem(IMPERSONATOR_META_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Recarregamento completo da página (F5, Ctrl+F5, Ctrl+Shift+R). */
export function isPageReload() {
  const entry = performance.getEntriesByType('navigation')[0];
  if (entry && 'type' in entry) {
    return entry.type === 'reload';
  }
  return performance.navigation?.type === 1;
}

/**
 * Hard/soft reload zera sessão e volta ao login (comportamento padrão do produto).
 * Deve rodar uma vez no boot, antes do router.
 */
export function resetAuthOnPageReload() {
  if (!isPageReload()) return false;
  clearSession();
  const loginPath = '/login';
  const path = window.location.pathname === '/' ? loginPath : window.location.pathname;
  if (path !== loginPath) {
    window.history.replaceState(null, '', loginPath);
  }
  return true;
}

export function isAuthenticated() {
  return !!getToken() || !!getImpersonationToken();
}

/** Decodifica payload JWT (sem validar assinatura — só UI). */
export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function getActiveContext() {
  const token = getImpersonationToken() || getToken();
  return token ? decodeJwt(token) : null;
}

export function isGlobalSession() {
  const ctx = getActiveContext();
  return ctx?.scope === 'global';
}

export function isImpersonating() {
  const ctx = getActiveContext();
  return !!ctx?.impersonatorId;
}
