/**
 * Cotações opcoes.net só para opções em custódia da holding (via API em produção).
 *
 *   node scripts/run-remote-custody-option-quotes.js
 *   node scripts/run-remote-custody-option-quotes.js --org=org-holding-001
 *
 * Requer CO_CEO_ADMIN_PASSWORD e deploy com sync-b3 que inclui opções (V0.0.108+).
 */
require('dotenv').config();

const orgId =
  process.argv.find((a) => a.startsWith('--org='))?.slice(6) ||
  process.env.PORTFOLIO_ORG_ID ||
  'org-holding-001';
const holdingUserId = process.env.HOLDING_OWNER_USER_ID || 'usr-augusto-001';
const holdingUserRoleId = process.env.HOLDING_OWNER_USER_ROLE_ID || 'ur-augusto-owner-001';

async function main() {
  const base = (process.env.APP_URL || 'https://platform.co-ceo.com.br').replace(/\/$/, '');
  const email = process.env.CO_CEO_ADMIN_EMAIL || 'admin@coceo.com.br';
  const password = process.env.CO_CEO_ADMIN_PASSWORD || process.env.CO_CEO_ADMIN_PASSWORD_PLAIN;
  if (!password) {
    throw new Error('Defina CO_CEO_ADMIN_PASSWORD no .env');
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
  if (!token) throw new Error('Login sem token');

  const impRes = await fetch(`${base}/api/auth/impersonate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      targetUserId: holdingUserId,
      userRoleId: holdingUserRoleId,
    }),
  });
  const impJson = await impRes.json();
  if (!impRes.ok || !impJson.token) {
    throw new Error(`impersonate falhou: ${impJson.error || impRes.status}`);
  }
  token = impJson.token;
  console.log(`Org: ${orgId} — sync cotações (ações + opções em carteira)...`);

  const syncRes = await fetch(`${base}/api/invest/quotes/sync-b3`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });
  const syncJson = await syncRes.json();
  console.log('sync-b3:', JSON.stringify(syncJson, null, 2));
  if (!syncRes.ok || !syncJson.success) {
    throw new Error(syncJson.error || `HTTP ${syncRes.status}`);
  }

  const portRes = await fetch(`${base}/api/invest/portfolio?assetClass=options`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const portJson = await portRes.json();
  if (!portRes.ok || !portJson.success) {
    throw new Error(portJson.error || `portfolio HTTP ${portRes.status}`);
  }
  const items = portJson.items || [];
  console.log(`\nOpções em carteira (${items.length}):`);
  for (const it of items.slice(0, 40)) {
    const prem = it.avgPrice;
    const quote = it.updatedQuote ?? it.lastPrice;
    console.log(
      `  ${it.ticker}: prêmio=${prem} cotação=${quote} %=${it.pnlPct ?? 0}`
    );
  }
  if (items.length > 40) console.log(`  ... +${items.length - 40} linhas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
