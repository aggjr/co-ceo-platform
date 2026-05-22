/**
 * Holding demo (Gonçalves) — mutações via CoCeoDataGateway.
 * Augusto = ORG_OWNER (super usuário da holding): tudo do cliente, nada da equipe co-CEO.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../../core/dal';
import { PasswordService } from '../../core/auth/PasswordService';
import { installerContext } from './lib/installerContext';
import { ensureInsert, ensureLink, findIdByColumn } from './lib/seedHelpers';
import { ROLE_IDS } from './iamCatalogIds';

dotenv.config();

const IDS = {
  org: 'org-holding-001',
  contract: 'ctr-holding-001',
  ownerUser: 'usr-augusto-001',
  ownerUserRole: 'ur-augusto-owner-001',
  teamMemberUser: 'usr-analista-001',
  teamMemberUserRole: 'ur-analista-viewer-001',
  coCeoLiaison: 'usr-co-ceo-001',
} as const;

async function runSeed() {
  const ownerEmail = process.env.HOLDING_OWNER_EMAIL || 'augustoggomes@yahoo.com.br';
  const ownerPassword = process.env.HOLDING_OWNER_PASSWORD || '12121976';

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = installerContext();
  const passwordHash = await PasswordService.hash(ownerPassword);

  try {
    try {
      await pool.query(
        'ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE AFTER is_active'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('Duplicate column name')) console.warn('DDL:', msg);
    }

    console.log('[002] Organização (holding)...');
    await ensureInsert(gateway, ctx, 'organizations', IDS.org, {
      parent_id: null,
      name: 'Holding Financeira Gonçalves',
      type: 'holding',
      path: '/org-holding-001/',
      status: 'active',
    });

    console.log('[002] Usuários...');
    await ensureInsert(gateway, ctx, 'users', IDS.coCeoLiaison, {
      email: 'admin@co-ceo.com',
      password_hash: await PasswordService.hash('changeme-co-ceo-liaison'),
      full_name: 'Gestor co-CEO (contrato)',
      preferred_name: 'co-CEO',
      is_active: true,
      must_change_password: true,
    });

    let ownerId: string = IDS.ownerUser;
    const byEmail = await findIdByColumn(gateway, ctx, 'users', 'email', ownerEmail);
    if (byEmail) ownerId = byEmail;

    const ownerPayload = {
      email: ownerEmail,
      password_hash: passwordHash,
      full_name: 'Augusto G. Gomes',
      preferred_name: 'Augusto',
      is_active: true,
      must_change_password: false,
    };
    const existingOwner = await gateway.findById(ctx, 'users', ownerId).catch(() => null);
    if (!existingOwner) {
      await gateway.insert(ctx, 'users', { id: ownerId, ...ownerPayload });
    } else {
      await gateway.update(ctx, 'users', ownerId, ownerPayload);
    }

    console.log('[002] Módulos...');
    for (const mod of [
      { id: 'mod-001', code: 'CORE', name: 'Chassi SaaS', is_active: true },
      { id: 'mod-002', code: 'INVEST', name: 'Wealth & Quant', is_active: true },
      { id: 'mod-003', code: 'CASH', name: 'Gestão Financeira', is_active: true },
    ]) {
      await ensureInsert(gateway, ctx, 'modules', mod.id, mod);
    }

    console.log('[002] Contrato + módulos licenciados...');
    await ensureInsert(gateway, ctx, 'contracts', IDS.contract, {
      organization_id: IDS.org,
      client_manager_user_id: ownerId,
      co_ceo_manager_user_id: IDS.coCeoLiaison,
      contract_start_date: new Date().toISOString().split('T')[0],
      status: 'active',
    });

    for (const moduleCode of ['CORE', 'INVEST'] as const) {
      await ensureLink(
        gateway,
        ctx,
        'contract_modules',
        { contract_id: IDS.contract, module_code: moduleCode, status: 'active' },
        { entityType: 'contract_modules', entityId: IDS.contract }
      );
    }

    console.log('[002] Augusto como ORG_OWNER (super usuário da holding)...');
    await ensureLink(
      gateway,
      ctx,
      'contract_users',
      {
        contract_id: IDS.contract,
        user_id: ownerId,
        default_organization_id: IDS.org,
        status: 'active',
      },
      { entityType: 'contract_users', entityId: IDS.contract }
    );

    await ensureLink(
      gateway,
      ctx,
      'user_roles',
      {
        id: IDS.ownerUserRole,
        user_id: ownerId,
        role_id: ROLE_IDS.ORG_OWNER,
        contract_id: IDS.contract,
        organization_id: IDS.org,
        is_primary: true,
      },
      { entityType: 'user_roles', entityId: IDS.ownerUserRole }
    );

    console.log('[002] Colaborador de exemplo (alvo de simulação)...');
    const teamEmail = process.env.HOLDING_TEAM_EMAIL || 'analista@holding.demo';
    const teamPassword = process.env.HOLDING_TEAM_PASSWORD || ownerPassword;
    const teamHash = await PasswordService.hash(teamPassword);

    await ensureInsert(gateway, ctx, 'users', IDS.teamMemberUser, {
      email: teamEmail,
      password_hash: teamHash,
      full_name: 'Analista Investimentos',
      preferred_name: 'Analista',
      is_active: true,
      must_change_password: false,
    });

    await ensureLink(
      gateway,
      ctx,
      'contract_users',
      {
        contract_id: IDS.contract,
        user_id: IDS.teamMemberUser,
        default_organization_id: IDS.org,
        status: 'active',
      },
      { entityType: 'contract_users', entityId: `${IDS.contract}-team` }
    );

    await ensureLink(
      gateway,
      ctx,
      'user_roles',
      {
        id: IDS.teamMemberUserRole,
        user_id: IDS.teamMemberUser,
        role_id: ROLE_IDS.ORG_VIEWER,
        contract_id: IDS.contract,
        organization_id: IDS.org,
        is_primary: true,
      },
      { entityType: 'user_roles', entityId: IDS.teamMemberUserRole }
    );

    // const teamRoleRow = await gateway.findById(ctx, 'user_roles', IDS.teamMemberUserRole);
    // if (teamRoleRow && teamRoleRow.organization_id == null) {
    //   await gateway.update(ctx, 'user_roles', IDS.teamMemberUserRole, {
    //     organization_id: IDS.org,
    //   });
    // }

    console.log('✅ Holding configurada via gateway.');
    console.log(`👤 Super usuário holding: ${ownerEmail}`);
    console.log('   Papel: ORG_OWNER — Cockpit cliente + INVEST; sem escopo plataforma co-CEO.');
  } catch (error) {
    console.error('❌ Falha no seed holding:', error);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runSeed();
