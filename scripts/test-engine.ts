import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal/CoCeoDataGateway';
import { PatrimonyDailyRebuildService } from '../src/core/invest/PatrimonyDailyRebuildService';

async function runTest() {
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool as any);
  try {
    const orgId = process.env.ORG_ID || 1; // Assuming 1 for the org
    console.log('Testing PatrimonyDailyRebuildService for Org:', orgId);
    
    const service = new PatrimonyDailyRebuildService(gateway);
    await service.rebuild({
      userId: 1,
      organizationId: Number(orgId),
      role: 'ADMIN'
    });
    console.log('Done rebuild');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

runTest();
