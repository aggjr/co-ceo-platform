import crypto from 'crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../../core/dal';
import { PasswordService } from '../../core/auth/PasswordService';
import { IamAuditService } from '../../core/auth/IamAuditService';
import { installerContext } from './lib/installerContext';
import { ensureInsert, ensureLink, findIdByColumn } from './lib/seedHelpers';
import { ROLE_IDS } from './iamCatalogIds';

dotenv.config();

/**
 * Super usuário plataforma — mutações via CoCeoDataGateway (nunca pool.query em tabelas de negócio).
 * Execute antes: migrations + npx ts-node src/database/seeds/005_iam_catalog.ts
 */
async function seedSuperAdmin() {
  const adminEmail = process.env.CO_CEO_ADMIN_EMAIL || 'admin@coceo.com.br';
  const recoveryEmail = process.env.CO_CEO_ADMIN_RECOVERY_EMAIL || 'recovery@coceo.com.br';
  const plainPassword = process.env.CO_CEO_ADMIN_PASSWORD;
  let userId = process.env.CO_CEO_ADMIN_USER_ID || '00000000-0000-4000-8000-00000000a001';

  if (!plainPassword) {
    console.error('❌ Defina CO_CEO_ADMIN_PASSWORD no ambiente antes de executar o seed.');
    process.exit(1);
  }

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
  const iamAudit = new IamAuditService(gateway);
  const passwordHash = await PasswordService.hash(plainPassword);
  const userRoleId = process.env.CO_CEO_ADMIN_USER_ROLE_ID || '00000000-0000-4000-8000-00000000b001';

  try {
    const byEmail = await findIdByColumn(gateway, ctx, 'users', 'email', adminEmail);
    if (byEmail) userId = byEmail;

    const existing = await gateway.findById(ctx, 'users', userId);
    const userPayload = {
      email: adminEmail,
      recovery_email: recoveryEmail,
      password_hash: passwordHash,
      full_name: 'Administrador CO-CEO',
      preferred_name: 'Super Admin',
      is_active: true,
      must_change_password: false,
    };

    if (!existing) {
      await gateway.insert(ctx, 'users', { id: userId, ...userPayload });
      await iamAudit.logChange(ctx, {
        changeType: 'SEED_INSERT',
        entityType: 'users',
        entityId: userId,
        newPayload: userPayload,
      });
    } else {
      await gateway.update(ctx, 'users', userId, userPayload);
      await iamAudit.logChange(ctx, {
        changeType: 'SEED_UPDATE',
        entityType: 'users',
        entityId: userId,
        oldPayload: existing as Record<string, unknown>,
        newPayload: userPayload,
      });
    }

    await ensureLink(
      gateway,
      ctx,
      'user_roles',
      {
        id: userRoleId,
        user_id: userId,
        role_id: ROLE_IDS.PLATFORM_SUPER_ADMIN,
        contract_id: null,
        organization_id: null,
        is_primary: true,
      },
      { entityType: 'user_roles', entityId: userRoleId }
    );

    console.log('✅ Super Admin configurado via gateway.');
    console.log(`👤 E-mail: ${adminEmail}`);
  } catch (error) {
    console.error('❌ Falha no seed:', error);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

seedSuperAdmin();
