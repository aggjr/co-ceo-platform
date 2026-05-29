import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const base = (process.env.APP_URL || 'https://plataforma.co-ceo.com.br').replace(/\/$/, '');

async function fetchJson(url: string, options: any = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

async function loginGlobal() {
  const email = process.env.CO_CEO_ADMIN_EMAIL || 'admin@coceo.com.br';
  const password = process.env.CO_CEO_ADMIN_PASSWORD || process.env.CO_CEO_ADMIN_PASSWORD_PLAIN;
  if (!password) {
    throw new Error('Defina CO_CEO_ADMIN_PASSWORD no .env.');
  }

  console.log(`[Recalc] Fazendo login global como ${email}...`);
  const { res, json } = await fetchJson(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !json.success) {
    throw new Error(`Login falhou: ${json.error || res.status}`);
  }

  let token = json.token;
  const contexts = json.contexts || json.availableContexts || [];
  const globalCtx = contexts.find((c: any) => c.scope === 'global');
  if (globalCtx?.userRoleId && json.userId) {
    const ctxRes = await fetchJson(`${base}/api/auth/select-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userId: json.userId, userRoleId: globalCtx.userRoleId }),
    });
    if (ctxRes.res.ok && ctxRes.json.token) token = ctxRes.json.token;
  }
  return token;
}

async function run() {
  try {
    const token = await loginGlobal();
    console.log('[Recalc] Autenticado. Acionando rota /api/invest/admin/recalc-curve...');

    const { res, json } = await fetchJson(`${base}/api/invest/admin/recalc-curve`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok && json.success) {
      console.log(`[Recalc] Sucesso! ${json.processed} dias recalculados.`);
      console.log('Últimos resultados:', json.results?.slice(-5));
    } else {
      console.error('[Recalc] Falha na API:', json);
    }
  } catch (err: any) {
    console.error('[Recalc] Erro:', err.message);
  }
}

run();
