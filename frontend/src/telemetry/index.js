import { apiRequest } from '../api/client.js';
import { getActiveContext, isAuthenticated } from '../auth/session.js';

const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 5000;
const SESSION_KEY = 'co_ceo_telemetry_session';

const SCREEN_EVENT_MAP = {
  '/login': { event_name: 'screen.auth.login', module_code: 'CORE' },
  '/cockpit': { event_name: 'screen.cockpit.hub', module_code: 'CORE' },
  '/cockpit/platform': { event_name: 'screen.cockpit.platform', module_code: 'CORE' },
  '/cockpit/client': { event_name: 'screen.cockpit.client', module_code: 'CORE' },
  '/cockpit/client/team': { event_name: 'screen.cockpit.team', module_code: 'CORE' },
};

let queue = [];
let flushTimer = null;
let lastScreen = null;
let lastScreenEnteredAt = null;

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function inferModule(path) {
  if (path.includes('invest')) return 'INVEST';
  if (path.includes('cockpit')) return 'CORE';
  return 'CORE';
}

function resolveScreen(path) {
  const mapped = SCREEN_EVENT_MAP[path];
  if (mapped) return { ...mapped, screen_path: path };
  const safe = path.replace(/[^a-z0-9/._-]/gi, '').replace(/\//g, '.') || 'root';
  return {
    event_name: `screen.app${safe}`,
    module_code: inferModule(path),
    screen_path: path,
  };
}

export function enqueueTelemetry(event) {
  if (!isAuthenticated()) return;
  const ctx = getActiveContext();
  queue.push({
    ...event,
    session_id: getSessionId(),
    metadata: {
      ...(event.metadata || {}),
      scope: ctx?.scope ?? null,
      contract_id: ctx?.contractId ?? null,
    },
    client_timestamp: new Date().toISOString(),
  });
  scheduleFlush();
}

export function trackScreenView(path) {
  const now = Date.now();
  if (lastScreen && lastScreenEnteredAt != null) {
    enqueueTelemetry({
      event_type: 'screen_leave',
      event_name: lastScreen.event_name,
      module_code: lastScreen.module_code,
      screen_path: lastScreen.screen_path,
      metadata: { duration_ms: now - lastScreenEnteredAt },
    });
  }

  const screen = resolveScreen(path);
  lastScreen = screen;
  lastScreenEnteredAt = now;

  enqueueTelemetry({
    event_type: 'screen_view',
    event_name: screen.event_name,
    module_code: screen.module_code,
    screen_path: screen.screen_path,
  });
}

export function trackButtonClick(eventName, options = {}) {
  enqueueTelemetry({
    event_type: 'button_click',
    event_name: eventName,
    module_code: options.module_code || inferModule(options.screen_path || ''),
    screen_path: options.screen_path || null,
    metadata: options.metadata || null,
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushTelemetry();
  }, FLUSH_INTERVAL_MS);
}

export async function flushTelemetry() {
  if (!isAuthenticated() || !queue.length) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await apiRequest('/api/telemetry/events', {
      method: 'POST',
      body: { events: batch },
    });
    if (queue.length) scheduleFlush();
  } catch {
    queue = batch.concat(queue).slice(0, MAX_BATCH * 3);
  }
}

export function initTelemetry() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeunload', () => {
    if (lastScreen && lastScreenEnteredAt != null) {
      enqueueTelemetry({
        event_type: 'screen_leave',
        event_name: lastScreen.event_name,
        module_code: lastScreen.module_code,
        screen_path: lastScreen.screen_path,
        metadata: { duration_ms: Date.now() - lastScreenEnteredAt },
      });
    }
    if (!queue.length) return;
    const token = localStorage.getItem('co_ceo_session');
    if (!token) return;
    const payload = JSON.stringify({ events: queue });
    queue = [];
    fetch('/api/telemetry/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTelemetry();
  });
}
