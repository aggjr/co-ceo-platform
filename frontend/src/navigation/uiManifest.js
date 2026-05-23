import { apiRequest } from '../api/client.js';

let cached = null;
let inFlight = null;

export function clearUiManifestCache() {
  cached = null;
  inFlight = null;
}

/**
 * Busca o manifesto de UI (menu + textos resolvidos para o tenant).
 * Resposta cacheada em memoria; ETag negocia o 304 no servidor quando a versao bate.
 */
export async function loadUiManifest({ locale = 'pt-BR' } = {}) {
  if (cached && cached.locale === locale) return cached;
  if (inFlight) return inFlight;
  inFlight = apiRequest(`/api/ui/manifest?locale=${encodeURIComponent(locale)}`)
    .then((data) => {
      cached = data;
      return data;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Retorna o texto resolvido para uma chave; se ausente, devolve o proprio key. */
export function resolveText(manifest, key) {
  if (!manifest?.texts) return key;
  return manifest.texts[key] ?? key;
}
