import { CoCeoDataGateway } from '../src/core/dal/index.js';
import { InvestController } from '../src/controllers/InvestController.js';
import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  const gateway = new CoCeoDataGateway(pool);
  const controller = new InvestController(gateway, pool);
  
  const req = {
    query: { from: '2026-01-01', to: '2026-05-31', method: 'mtm_btg' }
  };
  
  const res = {
    json: (data) => {
      console.log(JSON.stringify(data.portfolioIndexed, null, 2));
    }
  };
  
  const ctx = { organizationId: 'org-holding-001', scope: 'node' };
  
  // mock req and res
  await controller.listPortfolioImpl(ctx, req as any, res as any, pool);
  
  await pool.end();
}

main().catch(console.error);
