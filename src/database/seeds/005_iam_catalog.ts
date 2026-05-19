/**
 * Catálogo IAM (permissões, papéis, UI) — 100% via CoCeoDataGateway + SYSTEM_INSTALLER.
 * Substitui 005_permissions_and_roles.sql e 006_navigation_resources.sql para mutações.
 */
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../../core/dal';
import { installerContext } from './lib/installerContext';
import {
  ensureInsert,
  ensureLink,
  ensureRevokeLink,
  findIdByColumn,
  syncRolePermissions,
  syncRoleResourceGrants,
} from './lib/seedHelpers';
import { ROLE_IDS } from './iamCatalogIds';

dotenv.config();

const PERMISSIONS = [
  {
    id: '00000000-0000-4001-8000-000000000001',
    code: 'core:impersonate:execute',
    module: 'core',
    resource: 'impersonate',
    action: 'execute',
    description: 'Emular usuário do cliente',
    audience: 'platform',
  },
  {
    id: '00000000-0000-4001-8000-000000000002',
    code: 'cockpit:contracts:read',
    module: 'cockpit',
    resource: 'contracts',
    action: 'read',
    description: 'Listar contratos',
    audience: 'platform',
  },
  {
    id: '00000000-0000-4001-8000-000000000003',
    code: 'cockpit:contracts:write',
    module: 'cockpit',
    resource: 'contracts',
    action: 'write',
    description: 'Editar contratos',
    audience: 'platform',
  },
  {
    id: '00000000-0000-4001-8000-000000000004',
    code: 'cockpit:iam:read',
    module: 'cockpit',
    resource: 'iam',
    action: 'read',
    description: 'Ver papéis e permissões',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000005',
    code: 'cockpit:iam:manage_team',
    module: 'cockpit',
    resource: 'iam',
    action: 'manage',
    description: 'Gerir equipe e papéis do contrato',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000006',
    code: 'cockpit:team:read',
    module: 'cockpit',
    resource: 'team',
    action: 'read',
    description: 'Listar equipe',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000007',
    code: 'cockpit:team:write',
    module: 'cockpit',
    resource: 'team',
    action: 'write',
    description: 'Convidar e editar membros',
    audience: 'organization',
  },
  {
    id: '00000000-0000-4001-8000-000000000008',
    code: 'cockpit:impersonate:execute',
    module: 'cockpit',
    resource: 'impersonate',
    action: 'execute',
    description: 'Simular acesso de colaboradores na estrutura do contrato (suporte interno do cliente)',
    audience: 'organization',
  },
  {
    id: '00000000-0000-4001-8000-000000000009',
    code: 'cockpit:storage:read',
    module: 'cockpit',
    resource: 'storage',
    action: 'read',
    description: 'Ver uso de armazenamento',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000010',
    code: 'invest:ledger:read',
    module: 'invest',
    resource: 'ledger',
    action: 'read',
    description: 'Ler lançamentos',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000011',
    code: 'invest:ledger:write',
    module: 'invest',
    resource: 'ledger',
    action: 'write',
    description: 'Registrar boletas',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000012',
    code: 'invest:custody:read',
    module: 'invest',
    resource: 'custody',
    action: 'read',
    description: 'Ver custódia',
    audience: 'both',
  },
  {
    id: '00000000-0000-4001-8000-000000000013',
    code: 'quality:regression:read',
    module: 'quality',
    resource: 'regression',
    action: 'read',
    description: 'Ver painel de regressão e cobertura',
    audience: 'platform',
  },
  {
    id: '00000000-0000-4001-8000-000000000014',
    code: 'quality:regression:execute',
    module: 'quality',
    resource: 'regression',
    action: 'execute',
    description: 'Disparar suíte de regressão (ambiente dev)',
    audience: 'platform',
  },
] as const;

const ROLES = [
  {
    id: ROLE_IDS.PLATFORM_SUPER_ADMIN,
    code: 'PLATFORM_SUPER_ADMIN',
    name: 'Super Admin co-CEO',
    scope: 'global',
    is_system: true,
    description: 'Acesso total plataforma',
  },
  {
    id: ROLE_IDS.PLATFORM_SUPPORT,
    code: 'PLATFORM_SUPPORT',
    name: 'Suporte co-CEO',
    scope: 'global',
    is_system: true,
    description: 'Leitura e impersonation',
  },
  {
    id: ROLE_IDS.ORG_OWNER,
    code: 'ORG_OWNER',
    name: 'Super usuário da holding',
    scope: 'node',
    is_system: true,
    description:
      'Acesso total ao contrato (Cockpit cliente + módulos licenciados). Sem telas/permissões exclusivas da equipe co-CEO.',
  },
  {
    id: ROLE_IDS.ORG_MANAGER,
    code: 'ORG_MANAGER',
    name: 'Gestor Operacional',
    scope: 'node',
    is_system: true,
    description: 'Template: opera módulos',
  },
  {
    id: ROLE_IDS.ORG_VIEWER,
    code: 'ORG_VIEWER',
    name: 'Visualizador',
    scope: 'node',
    is_system: true,
    description: 'Somente INVEST (leitura). Sem Cockpit de gestão da empresa.',
  },
] as const;

const ACCESS_RESOURCES = [
  {
    id: '00000000-0000-4002-8000-000000000001',
    resource_key: 'screen.cockpit.platform',
    resource_type: 'screen',
    module_code: 'cockpit',
    label: 'Contratos',
    description: 'Gestão de contratos (co-CEO)',
  },
  {
    id: '00000000-0000-4002-8000-000000000002',
    resource_key: 'screen.cockpit.dashboard',
    resource_type: 'screen',
    module_code: 'cockpit',
    label: 'Dashboard Cockpit',
    description: 'Painel principal',
  },
  {
    id: '00000000-0000-4002-8000-000000000003',
    resource_key: 'screen.cockpit.team',
    resource_type: 'screen',
    module_code: 'cockpit',
    label: 'Equipe',
    description: 'Gestão de usuários do contrato',
  },
  {
    id: '00000000-0000-4002-8000-000000000004',
    resource_key: 'screen.cockpit.roles',
    resource_type: 'screen',
    module_code: 'cockpit',
    label: 'Papéis',
    description: 'Papéis e permissões',
  },
  {
    id: '00000000-0000-4002-8000-000000000005',
    resource_key: 'screen.cockpit.storage',
    resource_type: 'screen',
    module_code: 'cockpit',
    label: 'Armazenamento',
    description: 'Uso de dados',
  },
  {
    id: '00000000-0000-4002-8000-000000000006',
    resource_key: 'screen.invest.dashboard',
    resource_type: 'screen',
    module_code: 'invest',
    label: 'Dashboard INVEST',
    description: 'Patrimônio e resultado',
  },
  {
    id: '00000000-0000-4002-8000-000000000007',
    resource_key: 'button.invest.ledger.create',
    resource_type: 'button',
    module_code: 'invest',
    label: 'Nova boleta',
    description: 'Registrar lançamento',
  },
  {
    id: '00000000-0000-4002-8000-000000000008',
    resource_key: 'button.cockpit.team.invite',
    resource_type: 'button',
    module_code: 'cockpit',
    label: 'Convidar usuário',
    description: 'Adicionar membro',
  },
  {
    id: '00000000-0000-4002-8000-000000000009',
    resource_key: 'screen.cockpit.quality',
    resource_type: 'screen',
    module_code: 'cockpit',
    label: 'Qualidade / Regressão',
    description: 'Painel de testes, cobertura e retestes',
  },
  {
    id: '00000000-0000-4002-8000-000000000010',
    resource_key: 'screen.invest.portfolio',
    resource_type: 'screen',
    module_code: 'invest',
    label: 'Portfólio',
    description: 'Custódia — tabela ou cards',
  },
  {
    id: '00000000-0000-4002-8000-000000000011',
    resource_key: 'screen.invest.results',
    resource_type: 'screen',
    module_code: 'invest',
    label: 'Resultado (pivot)',
    description: 'Lucros, dividendos, opções e despesas',
  },
] as const;

function perm(map: Map<string, string>, code: string): string {
  const id = map.get(code);
  if (!id) throw new Error(`Permissão não resolvida: ${code}`);
  return id;
}

async function run() {
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

  console.log('[005] Catálogo IAM via CoCeoDataGateway...');

  const permissionIds = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const existingId = await findIdByColumn(gateway, ctx, 'permissions', 'code', p.code);
    const id = existingId ?? p.id;
    permissionIds.set(p.code, id);
    if (!existingId) {
      await ensureInsert(gateway, ctx, 'permissions', id, { ...p, id }, {
        entityType: 'permissions',
      });
    }
  }

  const resourceIds = new Map<string, string>();
  for (const ar of ACCESS_RESOURCES) {
    const existingId = await findIdByColumn(
      gateway,
      ctx,
      'access_resources',
      'resource_key',
      ar.resource_key
    );
    const id = existingId ?? ar.id;
    resourceIds.set(ar.resource_key, id);
    if (!existingId) {
      await ensureInsert(gateway, ctx, 'access_resources', id, { ...ar, id }, {
        entityType: 'access_resources',
      });
    }
  }

  const roleIds = new Map<string, string>();
  for (const r of ROLES) {
    const existingId = await findIdByColumn(gateway, ctx, 'roles', 'code', r.code);
    const roleId = existingId ?? r.id;
    roleIds.set(r.code, roleId);
    const rolePayload = {
      code: r.code,
      name: r.name,
      scope: r.scope,
      owner_organization_id: null,
      is_system: r.is_system,
      description: r.description,
      perm_version: 1,
    };
    if (!existingId) {
      await ensureInsert(gateway, ctx, 'roles', roleId, rolePayload, { entityType: 'roles' });
    } else if (r.code === 'ORG_OWNER') {
      await gateway.update(ctx, 'roles', roleId, rolePayload);
    }
  }

  const superAdminId = roleIds.get('PLATFORM_SUPER_ADMIN')!;
  for (const p of PERMISSIONS) {
    await ensureLink(
      gateway,
      ctx,
      'role_permissions',
      { role_id: superAdminId, permission_id: permissionIds.get(p.code)! },
      { entityType: 'role_permissions', entityId: superAdminId }
    );
  }

  const supportPerms = [
    'core:impersonate:execute',
    'cockpit:contracts:read',
    'cockpit:iam:read',
    'cockpit:storage:read',
    'cockpit:team:read',
    'quality:regression:read',
  ];
  for (const code of supportPerms) {
    await ensureLink(
      gateway,
      ctx,
      'role_permissions',
      {
        role_id: roleIds.get('PLATFORM_SUPPORT')!,
        permission_id: perm(permissionIds, code),
      },
      { entityType: 'role_permissions', entityId: roleIds.get('PLATFORM_SUPPORT')! }
    );
  }

  for (const p of PERMISSIONS) {
    if (p.code.startsWith('core:impersonate')) continue;
    if (p.audience === 'platform') continue;
    await ensureLink(
      gateway,
      ctx,
      'role_permissions',
      { role_id: roleIds.get('ORG_OWNER')!, permission_id: permissionIds.get(p.code)! },
      { entityType: 'role_permissions', entityId: roleIds.get('ORG_OWNER')! }
    );
  }

  for (const code of [
    'invest:ledger:read',
    'invest:ledger:write',
    'invest:custody:read',
    'cockpit:storage:read',
  ]) {
    await ensureLink(
      gateway,
      ctx,
      'role_permissions',
      { role_id: roleIds.get('ORG_MANAGER')!, permission_id: perm(permissionIds, code) },
      { entityType: 'role_permissions', entityId: roleIds.get('ORG_MANAGER')! }
    );
  }

  const viewerPermCodes = ['invest:ledger:read', 'invest:custody:read'] as const;
  for (const code of viewerPermCodes) {
    await ensureLink(
      gateway,
      ctx,
      'role_permissions',
      { role_id: roleIds.get('ORG_VIEWER')!, permission_id: perm(permissionIds, code) },
      { entityType: 'role_permissions', entityId: roleIds.get('ORG_VIEWER')! }
    );
  }

  for (const ar of ACCESS_RESOURCES) {
    await ensureLink(
      gateway,
      ctx,
      'role_resource_grants',
      {
        role_id: superAdminId,
        resource_id: resourceIds.get(ar.resource_key)!,
        effect: 'allow',
      },
      { entityType: 'role_resource_grants', entityId: superAdminId }
    );
  }

  const supportScreens = ACCESS_RESOURCES.filter(
    (ar) =>
      ar.resource_key.startsWith('screen.') ||
      ar.resource_key.startsWith('button.cockpit.')
  );
  for (const ar of supportScreens) {
    await ensureLink(
      gateway,
      ctx,
      'role_resource_grants',
      {
        role_id: roleIds.get('PLATFORM_SUPPORT')!,
        resource_id: resourceIds.get(ar.resource_key)!,
        effect: 'allow',
      },
      { entityType: 'role_resource_grants', entityId: roleIds.get('PLATFORM_SUPPORT')! }
    );
  }

  const ownerResources = ACCESS_RESOURCES.filter(
    (ar) =>
      (ar.resource_key.startsWith('screen.cockpit.') &&
        ar.resource_key !== 'screen.cockpit.platform') ||
      ar.resource_key.startsWith('screen.invest.') ||
      ar.resource_key.startsWith('button.')
  );
  for (const ar of ownerResources) {
    await ensureLink(
      gateway,
      ctx,
      'role_resource_grants',
      {
        role_id: roleIds.get('ORG_OWNER')!,
        resource_id: resourceIds.get(ar.resource_key)!,
        effect: 'allow',
      },
      { entityType: 'role_resource_grants', entityId: roleIds.get('ORG_OWNER')! }
    );
  }

  const platformScreenId = resourceIds.get('screen.cockpit.platform');
  if (platformScreenId) {
    await ensureRevokeLink(
      gateway,
      ctx,
      'role_resource_grants',
      { role_id: roleIds.get('ORG_OWNER')!, resource_id: platformScreenId },
      { entityType: 'role_resource_grants', entityId: roleIds.get('ORG_OWNER')! }
    );
  }

  const viewerScreenKeys = [
    'screen.invest.dashboard',
    'screen.invest.portfolio',
    'screen.invest.results',
  ] as const;
  for (const key of viewerScreenKeys) {
    await ensureLink(
      gateway,
      ctx,
      'role_resource_grants',
      {
        role_id: roleIds.get('ORG_VIEWER')!,
        resource_id: resourceIds.get(key)!,
        effect: 'allow',
      },
      { entityType: 'role_resource_grants', entityId: roleIds.get('ORG_VIEWER')! }
    );
  }

  const viewerRoleId = roleIds.get('ORG_VIEWER')!;
  await syncRolePermissions(
    gateway,
    ctx,
    viewerRoleId,
    viewerPermCodes.map((c) => permissionIds.get(c)!)
  );
  await syncRoleResourceGrants(
    gateway,
    ctx,
    viewerRoleId,
    viewerScreenKeys.map((k) => resourceIds.get(k)!)
  );

  const managerScreenKeys = [
    'screen.cockpit.dashboard',
    'screen.cockpit.team',
    'screen.cockpit.storage',
    'screen.invest.dashboard',
    'screen.invest.portfolio',
    'screen.invest.results',
  ] as const;
  for (const key of managerScreenKeys) {
    await ensureLink(
      gateway,
      ctx,
      'role_resource_grants',
      {
        role_id: roleIds.get('ORG_MANAGER')!,
        resource_id: resourceIds.get(key)!,
        effect: 'allow',
      },
      { entityType: 'role_resource_grants', entityId: roleIds.get('ORG_MANAGER')! }
    );
  }

  console.log('✅ Catálogo IAM concluído (audit_logs + iam_config_audit).');
  await pool.end();
}

run().catch((err) => {
  console.error('❌ Falha no seed IAM:', err);
  process.exit(1);
});
