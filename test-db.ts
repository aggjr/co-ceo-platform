import { setupTestDb } from './tests/setup';

async function run() {
  const db = await setupTestDb();
  
  const [rows] = await db.query('SELECT * FROM invest_patrimony_monthly_anchors');
  console.log('DB Anchors:', rows);
  
  process.exit(0);
}

run();
