/**
 * Publica em produção: redeploy EasyPanel (webhook) + aguarda versão + sincroniza catálogo UI via API.
 *
 * Variáveis (.env):
 *   APP_URL=https://platform.co-ceo.com.br
 *   CO_CEO_ADMIN_EMAIL / CO_CEO_ADMIN_PASSWORD
 *   EASYPANEL_DEPLOY_WEBHOOK_URL=https://<painel>/api/deploy/<token>
 */
require('dotenv').config();
const { execSync } = require('child_process');
const pkg = require('../package.json');

const base = (process.env.APP_URL || 'https://platform.co-ceo.com.br').replace(/\/$/, '');
const targetVersion = `V${pkg.version.replace(/^v/i, '')}`.replace(/^V/, 'V');

async function fetchJson(url, options = {}) {
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

async function getRemoteVersion() {
  const { res, json } = await fetchJson(`${base}/api/version`);
  if (!res.ok) return null;
  return json.version || null;
}

function parseVersion(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function versionGte(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return false;
  if (va.major !== vb.major) return va.major > vb.major;
  if (va.minor !== vb.minor) return va.minor > vb.minor;
  return va.patch >= vb.patch;
}

async function loginGlobal() {
  const email = process.env.CO_CEO_ADMIN_EMAIL || 'admin@coceo.com.br';
  const password = process.env.CO_CEO_ADMIN_PASSWORD || process.env.CO_CEO_ADMIN_PASSWORD_PLAIN;
  if (!password) {
    throw new Error('Defina CO_CEO_ADMIN_PASSWORD no .env.');
  }

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
  const globalCtx = contexts.find((c) => c.scope === 'global');
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

async function applyUiCatalogViaApi(token) {
  const { res, json } = await fetchJson(`${base}/api/platform/ui-catalog/apply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok || !json.success) {
    throw new Error(json.error || `HTTP ${res.status} ao sincronizar catálogo UI`);
  }
  return json;
}

async function waitForVersion(minVersion, maxWaitMs = 12 * 60 * 1000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxWaitMs) {
    last = await getRemoteVersion();
    console.log(`[deploy] Produção: ${last ?? '?'} (alvo >= ${minVersion})`);
    if (last && versionGte(last, minVersion)) return last;
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(
    `Timeout aguardando ${minVersion} em produção (última: ${last}). Configure EASYPANEL_DEPLOY_WEBHOOK_URL e branch main no EasyPanel.`
  );
}

async function triggerEasypanelDeploy() {
  const webhook = process.env.EASYPANEL_DEPLOY_WEBHOOK_URL;
  if (!webhook) {
    console.warn(
      '[deploy] EASYPANEL_DEPLOY_WEBHOOK_URL ausente — não foi possível disparar redeploy automático.'
    );
    console.warn(
      '[deploy] Cole o webhook do EasyPanel (Deploy → URL) em .env e rode de novo, ou clique Redeploy no painel.'
    );
    return false;
  }
  const res = await fetch(webhook, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Webhook EasyPanel falhou: HTTP ${res.status}`);
  }
  console.log('[deploy] Webhook EasyPanel acionado.');
  return true;
}

(async () => {
  const before = await getRemoteVersion();
  console.log(`[deploy] Produção atual: ${before ?? '?'}`);
  console.log(`[deploy] Pacote local: ${targetVersion}`);

  const triggered = await triggerEasypanelDeploy();

  if (triggered || !versionGte(before, targetVersion)) {
    await waitForVersion(targetVersion);
  } else {
    console.log('[deploy] Produção já na versão alvo (sem webhook).');
  }

  const token = await loginGlobal();

  try {
    const applied = await applyUiCatalogViaApi(token);
    console.log('[deploy] Catálogo UI via API:', JSON.stringify(applied.sample, null, 2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404|não encontrado|not found/i.test(msg)) {
      console.warn('[deploy] Endpoint apply ainda ausente — catálogo será aplicado no boot do container.');
    } else {
      throw e;
    }
  }

  const manifestRes = await fetchJson(`${base}/api/ui/manifest?locale=pt-BR`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (manifestRes.res.ok && manifestRes.json.menu) {
    const invest = manifestRes.json.menu.find((m) => m.id === 'invest');
    const labels = (invest?.items || []).map((i) => i.label).join(' | ');
    console.log(`[deploy] Menu INVEST: ${labels}`);
  }

  console.log(`\n[deploy] OK — produção ${await getRemoteVersion()}`);
})().catch((err) => {
  console.error('[deploy] Falha:', err.message || err);
  process.exit(1);
});
