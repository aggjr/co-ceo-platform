import { apiRequest } from '../api/client.js';

function allowedKeys(matrix) {
  const set = new Set();
  for (const r of matrix?.resources || []) {
    if (r.effect === 'allow' && r.key) set.add(r.key);
  }
  return set;
}

export function hasCockpitClientScreens(matrix) {
  const allowed = allowedKeys(matrix);
  for (const key of allowed) {
    if (key.startsWith('screen.cockpit.') && key !== 'screen.cockpit.platform') {
      return true;
    }
  }
  return false;
}

export async function fetchAccessMatrix() {
  return apiRequest('/api/cockpit/me/access-matrix').catch(() => ({ resources: [] }));
}

export async function resolveClientLandingPath() {
  const matrix = await fetchAccessMatrix();
  const allowed = allowedKeys(matrix);
  if (allowed.has('screen.cockpit.dashboard')) return '/cockpit/client';
  if (allowed.has('screen.invest.dashboard')) return '/invest';
  return '/invest';
}
