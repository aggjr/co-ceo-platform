import { clearSession, getBearerToken } from '../auth/session.js';
import { navigate } from '../router.js';

const API_BASE = '';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function authHeaders() {
  const token = getBearerToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, auth = true } = options;
  const headers = auth ? authHeaders() : { 'Content-Type': 'application/json' };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      clearSession();
      const loginPath = '/login';
      if (!window.location.pathname.startsWith(loginPath)) {
        navigate(loginPath);
      }
    }
    throw new ApiError(data?.error || res.statusText, res.status, data);
  }
  return data;
}
