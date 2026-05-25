import { apiRequest } from '../api/client.js';

let cached = null;
let inflight = null;

/**
 * Período e benchmark vindos do livro razão (GET /api/invest/ui-context).
 */
export async function loadInvestUiContext() {
  if (cached) return cached;
  if (!inflight) {
    inflight = apiRequest('/api/invest/ui-context')
      .then((res) => {
        cached = res?.context ?? null;
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function clearInvestUiContextCache() {
  cached = null;
}

export function todayIsoLocal() {
  return new Date().toISOString().slice(0, 10);
}

/** Valores padrão de período a partir do contexto da API. */
export function periodDefaults(context) {
  const today = context?.today ?? todayIsoLocal();
  const defaultFrom = context?.defaultFrom ?? today;
  const periodMin = context?.periodMin ?? defaultFrom;
  return { today, defaultFrom, periodMin };
}
