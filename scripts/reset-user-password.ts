/**
 * Redefine senha de um usuário (bcrypt) via gateway.
 *
 *   set RESET_USER_PASSWORD=SuaNovaSenha
 *   npx ts-node scripts/reset-user-password.ts augustoggomes@yahoo.com.br
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { PasswordService } from '../src/core/auth/PasswordService';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { findIdByColumn } from '../src/database/seeds/lib/seedHelpers';

dotenv.config();

async function main() {
  const email = (process.argv[2] || process.env.RESET_USER_EMAIL || '').trim().toLowerCase();
  const plain = process.env.RESET_USER_PASSWORD || process.argv[3];
  if (!email || !plain) {
    console.error('Uso: RESET_USER_PASSWORD=... npx ts-node scripts/reset-user-password.ts <email>');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 3,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = installerContext();

  try {
    const userId = await findIdByColumn(gateway, ctx, 'users', 'email', email);
    if (!userId) {
      console.error(`Usuário não encontrado: ${email}`);
      process.exit(1);
    }
    const passwordHash = await PasswordService.hash(plain);
    await gateway.update(ctx, 'users', userId, {
      password_hash: passwordHash,
      must_change_password: false,
      is_active: true,
    });
    console.log(`Senha atualizada para ${email} (id ${userId}).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
