/**
 * Garante licença INVEST + papéis/recursos para o titular da holding (Augusto).
 * Todas as mutações passam pelo CoCeoDataGateway (wrapper).
 *
 * Uso: npm run seed:invest-access
 *      HOLDING_OWNER_EMAIL=... npm run seed:invest-access
 *
 * Escala (futuro): ver docs/architecture/cockpit_iam_model.md §10 — pipeline / UI interna co-CEO.
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import {
  ensureInsert,
  ensureLink,
  ensureRevokeLink,
  findIdByColumn,
} from '../src/database/seeds/lib/seedHelpers';
import { ROLE_IDS } from '../src/database/seeds/iamCatalogIds';

dotenv.config();

const CONTRACT_ID = process.env.HOLDING_CONTRACT_ID || 'ctr-holding-001';
const ORG_ID = process.env.HOLDING_ORG_ID || 'org-holding-001';
const OWNER_EMAIL = process.env.HOLDING_OWNER_EMAIL || 'augustoggomes@yahoo.com.br';
const OWNER_USER_ROLE_ID = 'ur-augusto-owner-001';

const INVEST_PERMISSION_CODES = [
  'invest:ledger:read',
  'invest:ledger:write',
  'invest:custody:read',
] as const;

const INVEST_SCREEN_KEYS = [
  'screen.invest.dashboard',
  'screen.invest.portfolio',
  'screen.invest.results',
] as const;

const OWNER_COCKPIT_SCREEN_KEYS = [
  'screen.cockpit.dashboard',
  'screen.cockpit.team',
  'screen.cockpit.roles',
  'screen.cockpit.storage',
] as const;

const OWNER_BUTTON_KEYS = [
  'button.invest.ledger.create',
  'button.cockpit.team.invite',
] as const;

async function resolvePermissionIds(
  gateway: CoCeoDataGateway,
  ctx: ReturnType<typeof installerContext>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const code of INVEST_PERMISSION_CODES) {
    const id = await findIdByColumn(gateway, ctx, 'permissions', 'code', code);
    if (!id) throw new Error(`Permissão ausente no catálogo: ${code}. Rode npm run seed:iam`);
    map.set(code, id);
  }
  return map;
}

async function resolveResourceIds(
  gateway: CoCeoDataGateway,
  ctx: ReturnType<typeof installerContext>,
  keys: readonly string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const key of keys) {
    const id = await findIdByColumn(gateway, ctx, 'access_resources', 'resource_key', key);
    if (!id) throw new Error(`Recurso ausente: ${key}. Rode npm run seed:iam`);
    map.set(key, id);
  }
  return map;
}

async function grantOwnerInvestAccess(
  gateway: CoCeoDataGateway,
  ctx: ReturnType<typeof installerContext>,
  ownerUserId: string
): Promise<void> {
  const permissionIds = await resolvePermissionIds(gateway, ctx);
  const screenKeys = [
    ...INVEST_SCREEN_KEYS,
    ...OWNER_COCKPIT_SCREEN_KEYS,
    ...OWNER_BUTTON_KEYS,
  ];
  const resourceIds = await resolveResourceIds(gateway, ctx, screenKeys);

  console.log('[grant-invest] Contrato — módulo INVEST ativo...');
  await ensureLink(
    gateway,
    ctx,
    'contract_modules',
    { contract_id: CONTRACT_ID, module_code: 'INVEST', status: 'active' },
    { entityType: 'contract_modules', entityId: CONTRACT_ID }
  );
  await ensureLink(
    gateway,
    ctx,
    'contract_modules',
    { contract_id: CONTRACT_ID, module_code: 'CORE', status: 'active' },
    { entityType: 'contract_modules', entityId: `${CONTRACT_ID}-core` }
  );

  console.log('[grant-invest] Vínculo do usuário ao contrato...');
  await ensureLink(
    gateway,
    ctx,
    'contract_users',
    {
      contract_id: CONTRACT_ID,
      user_id: ownerUserId,
      default_organization_id: ORG_ID,
      status: 'active',
    },
    { entityType: 'contract_users', entityId: CONTRACT_ID }
  );

  console.log('[grant-invest] Papel ORG_OWNER (super usuário holding)...');
  await ensureLink(
    gateway,
    ctx,
    'user_roles',
    {
      id: OWNER_USER_ROLE_ID,
      user_id: ownerUserId,
      role_id: ROLE_IDS.ORG_OWNER,
      contract_id: CONTRACT_ID,
      organization_id: ORG_ID,
      is_primary: true,
    },
    { entityType: 'user_roles', entityId: OWNER_USER_ROLE_ID }
  );

  const roleId = ROLE_IDS.ORG_OWNER;

  console.log('[grant-invest] Permissões API invest:* no ORG_OWNER...');
  for (const code of INVEST_PERMISSION_CODES) {
    await ensureLink(
      gateway,
      ctx,
      'role_permissions',
      { role_id: roleId, permission_id: permissionIds.get(code)! },
      { entityType: 'role_permissions', entityId: roleId }
    );
  }

  console.log('[grant-invest] Telas INVEST + Cockpit cliente no ORG_OWNER...');
  for (const key of screenKeys) {
    await ensureLink(
      gateway,
      ctx,
      'role_resource_grants',
      {
        role_id: roleId,
        resource_id: resourceIds.get(key)!,
        effect: 'allow',
      },
      { entityType: 'role_resource_grants', entityId: roleId }
    );
  }

  const platformScreenId = resourceIds.get('screen.cockpit.platform');
  if (platformScreenId) {
    await ensureRevokeLink(
      gateway,
      ctx,
      'role_resource_grants',
      { role_id: roleId, resource_id: platformScreenId },
      { entityType: 'role_resource_grants', entityId: roleId }
    );
  }

  console.log('[grant-invest] Módulo INVEST registrado...');
  await ensureInsert(gateway, ctx, 'modules', 'mod-002', {
    code: 'INVEST',
    name: 'Wealth & Quant',
    is_active: true,
  });
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = installerContext();

  try {
    const ownerId =
      (await findIdByColumn(gateway, ctx, 'users', 'email', OWNER_EMAIL)) ||
      (await findIdByColumn(gateway, ctx, 'users', 'email', OWNER_EMAIL.toLowerCase()));

    if (!ownerId) {
      throw new Error(
        `Usuário não encontrado (${OWNER_EMAIL}). Rode npm run seed:holding primeiro.`
      );
    }

    const contract = await gateway.findById(ctx, 'contracts', CONTRACT_ID).catch(() => null);
    if (!contract) {
      throw new Error(`Contrato ${CONTRACT_ID} ausente. Rode npm run seed:holding.`);
    }

    await grantOwnerInvestAccess(gateway, ctx, ownerId);

    console.log('✅ Acesso INVEST concedido via gateway.');
    console.log(`   Usuário: ${OWNER_EMAIL} (${ownerId})`);
    console.log(`   Contrato: ${CONTRACT_ID} | Papel: ORG_OWNER`);
    console.log(`   Telas: ${INVEST_SCREEN_KEYS.join(', ')}`);
    console.log('   Após rodar o script, faça logout/login ou reabra a emulação.');
    console.log('   Frontend: npm run build:web (ou npm run dev na porta 5173).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ grant-invest-access-holding:', err);
  process.exit(1);
});
