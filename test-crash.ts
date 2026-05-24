
import { pool } from './src/database/connection';
import { InvestController } from './src/controllers/InvestController';
import { LedgerEngine } from './src/core/invest/LedgerEngine';

async function run() {
  try {
    const orgRes = await pool.query('SELECT id FROM iam_organizations LIMIT 1');
    const orgId = (orgRes as any)[0]?.[0]?.id;
    if (!orgId) throw new Error('No org');

    const req: any = {
      userContext: { organizationId: orgId },
      query: { from: '2026-01-01', to: '2026-05-22', method: 'mtm_economic' }
    };
    const res: any = {
      status: (code: number) => ({
        json: (data: any) => console.log('HTTP', code, data)
      })
    };
    
    const ctrl = new InvestController(new LedgerEngine());
    await (ctrl as any).getPatrimonyDailyImpl(req, res);
    console.log('Finished successfully');
  } catch (err) {
    console.error('CRASH:', err);
  } finally {
    process.exit(0);
  }
}

run();

