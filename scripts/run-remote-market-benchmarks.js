/**
 * Popula CDI + PRIO3 no banco do ambiente alvo.
 *
 * Modo A — direto (MySQL remoto acessível):
 *   REMOTE_DB_PASSWORD=... node scripts/run-remote-market-benchmarks.js
 *
 * Modo B — via API em produção (usa conexão interna do app):
 *   node scripts/run-remote-market-benchmarks.js --via-api
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { execSync } = require('child_process');

const viaApi = process.argv.includes('--via-api');
const from =
  process.argv.find((a) => a.startsWith('--from='))?.slice(7)?.slice(0, 10) || '2025-12-01';
const to =
  process.argv.find((a) => a.startsWith('--to='))?.slice(5)?.slice(0, 10) ||
  new Date().toISOString().slice(0, 10);

async function runLocalSeed(host, user, password, database) {
  process.env.DB_HOST = host;
  process.env.DB_USER = user;
  process.env.DB_PASSWORD = password;
  process.env.DB_NAME = database;
  const cmd = `node ./node_modules/ts-node/dist/bin.js scripts/seed-market-benchmarks.ts --from=${from} --to=${to}`;
  console.log('>', cmd, `@ ${host}/${database}`);
  execSync(cmd, { cwd: path.join(__dirname, '..'), stdio: 'inherit', env: process.env });
}

async function applyRemoteMigrations(host, user, password, database) {
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    multipleStatements: true,
  });
  for (const file of ['22_market_quotes_global.sql', '23_market_benchmark_seed.sql']) {
    const full = path.join(__dirname, '..', 'src', 'database', 'migrations', file);
    if (!fs.existsSync(full)) continue;
    if (file.startsWith('22')) {
      const [t] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.tables
         WHERE table_schema = ? AND table_name = 'market_index_daily'`,
        [database]
      );
      if (Number(t[0]?.n ?? 0) > 0) continue;
    }
    console.log('Aplicando', file);
    await conn.query(fs.readFileSync(full, 'utf8'));
  }
  await conn.end();
}

async function runViaApi() {
  const base = (process.env.APP_URL || 'https://platform.co-ceo.com.br').replace(/\/$/, '');
  const email = process.env.CO_CEO_ADMIN_EMAIL || 'admin@coceo.com.br';
  const password = process.env.CO_CEO_ADMIN_PASSWORD || process.env.CO_CEO_ADMIN_PASSWORD_PLAIN;
  if (!password) {
    throw new Error('Defina CO_CEO_ADMIN_PASSWORD no .env para chamar a API de produção.');
  }

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userId: loginJson.userId, userRoleId: globalCtx.userRoleId }),
    });
    const ctxJson = await ctxRes.json();
    if (ctxRes.ok && ctxJson.token) token = ctxJson.token;
  }

  const seedRes = await fetch(
    `${base}/api/invest/market/seed-benchmarks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, stockTicker: 'PRIO3' }),
    }
  );
  const seedJson = await seedRes.json();
  console.log(JSON.stringify(seedJson, null, 2));
  if (!seedRes.ok || !seedJson.success) {
    throw new Error(seedJson.error || `HTTP ${seedRes.status}`);
  }
}

(async () => {
  if (viaApi) {
    await runViaApi();
    return;
  }

  const host = process.env.REMOTE_DB_HOST || '69.62.99.34';
  const user = process.env.REMOTE_DB_USER || 'root';
  const password = process.env.REMOTE_DB_PASSWORD;
  const database = process.env.REMOTE_DB_NAME || 'co_ceo_platform';

  if (!password) {
    console.error('Sem REMOTE_DB_PASSWORD. Use --via-api ou defina a senha remota.');
    process.exit(1);
  }

  try {
    await applyRemoteMigrations(host, user, password, database);
    await runLocalSeed(host, user, password, database);
    console.log('\nOK remoto (MySQL direto).');
  } catch (e) {
    console.warn('MySQL direto falhou:', e instanceof Error ? e.message : e);
    console.log('Tentando via API de produção...\n');
    await runViaApi();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
