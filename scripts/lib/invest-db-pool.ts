/**
 * Pool MySQL compartilhado por scripts INVEST (local ou remoto via env).
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

export function resolveInvestDbConfig(): mysql.PoolOptions {
  return {
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    connectTimeout: 30000,
  };
}

export function requireDbPassword(): string {
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }
  return password;
}

export function createInvestPool(): mysql.Pool {
  const password = requireDbPassword();
  return mysql.createPool({ ...resolveInvestDbConfig(), password });
}
