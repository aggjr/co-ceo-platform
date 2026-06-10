import { describe, test } from 'vitest';
import { setupTestDb } from './tests/setup/dbSetup';

describe('Check DB Anchors', () => {
  test('fetch anchors', async () => {
    const db = await setupTestDb();
    const [rows] = await db.query('SELECT * FROM invest_patrimony_monthly_anchors');
    console.log('ANCHORS IN DB:', rows);
  });
});
