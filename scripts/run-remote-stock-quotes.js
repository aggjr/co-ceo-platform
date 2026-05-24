/**
 * Sincroniza cotações atuais (brapi → market_quotes_daily) no servidor remoto.
 *
 * Modo A — MySQL:
 *   REMOTE_DB_PASSWORD=... node scripts/run-remote-stock-quotes.js
 *
 * Modo B — API produção (após deploy com fix brapi 1 ticker/request):
 *   node scripts/run-remote-stock-quotes.js --via-api
 */
require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

const viaApi = process.argv.includes('--via-api');

async function runViaApi() {
  const base = (process.env.APP_URL || 'https://platform.co-ceo.com.br').replace(/\/$/, '');
  const email = process.env.CO_CEO_ADMIN_EMAIL || 'admin@coceo.com.br';
  const password = process.env.CO_CEO_ADMIN_PASSWORD;
  if (!password) throw new Error('Defina CO_CEO_ADMIN_PASSWORD no .env');

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok || !loginJson.success) {
    throw new Error(`Login falhou: ${loginJson.error || loginRes.status}`);
  }

  let token = loginJson.token;
  const contexts = loginJson.contexts || loginJson.availableContexts || [];
  const globalCtx = contexts.find((c) => c.scope === 'global');
  if (globalCtx?.userRoleId && loginJson.userId) {
    const ctxRes = await fetch(`${base}/api/auth/select-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: loginJson.userId,
        userRoleId: globalCtx.userRoleId,
      }),
    });
    const ctxJson = await ctxRes.json();
    if (ctxRes.ok && ctxJson.token) token = ctxJson.token;
  }
  if (!token) throw new Error('Token de login ausente.');

  const syncRes = await fetch(`${base}/api/invest/market/sync-stocks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });
  const syncJson = await syncRes.json();
  console.log('sync-stocks status', syncRes.status);
  console.log(JSON.stringify(syncJson, null, 2));
  if (!syncRes.ok) process.exit(1);
}

async function runMysql() {
  if (!process.env.REMOTE_DB_PASSWORD && !process.env.DB_PASSWORD) {
    throw new Error('Defina REMOTE_DB_PASSWORD ou DB_PASSWORD.');
  }
  const cmd = 'node ./node_modules/ts-node/dist/bin.js scripts/sync-market-quotes-stocks.ts';
  execSync(cmd, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      REMOTE_DB_HOST: process.env.REMOTE_DB_HOST || '69.62.99.34',
      REMOTE_DB_NAME: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
    },
  });
}

(async () => {
  if (viaApi) await runViaApi();
  else await runMysql();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
