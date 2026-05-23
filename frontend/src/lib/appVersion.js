import { APP_VERSION } from '../generated/version.js';

/**
 * Versao exibida na UI: fallback do build (generated) + fonte canônica /api/version apos deploy.
 */
export { APP_VERSION };

export async function fetchAppVersion() {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return APP_VERSION;
    const data = await res.json();
    return typeof data?.version === 'string' && data.version ? data.version : APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

/** Login (.card-version) e shell ([data-app-version]). */
export async function applyAppVersionToDom(root = document) {
  const version = await fetchAppVersion();
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll('[data-app-version], .card-version').forEach((el) => {
    el.textContent = version;
  });
  return version;
}
