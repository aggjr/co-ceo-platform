import { config } from 'dotenv';
config();
import db from './src/config/database';
import { CoCeoDataGateway } from './src/core/dal/CoCeoDataGateway';
import { InvestController } from './src/controllers/InvestController';
import express from 'express';

async function run() {
  try {
    const gateway = new CoCeoDataGateway(db);
    const controller = new InvestController(gateway);
    const orgId = '14eb3115-38b4-4bca-85f0-f9bd0ec3dded';

    const [orgs] = await db.query('SELECT id FROM organizations LIMIT 1');
    const actualOrgId = (orgs as any)[0]?.id;

    const req: any = {
      userContext: { organizationId: actualOrgId, roleId: 'admin', scope: 'tenant' },
      query: { assetClass: 'equity' }
    };

    const res: any = {
      json: (data: any) => {
        console.log('Portfolio returned:');
        const itub = data.items.find((i: any) => i.ticker === 'ITUB4');
        const prio = data.items.find((i: any) => i.ticker === 'PRIO3');
        console.log('ITUB4:', JSON.stringify(itub, null, 2));
        console.log('PRIO3:', JSON.stringify(prio, null, 2));
      },
      status: (code: number) => ({ json: (d: any) => console.log('Error', code, d) })
    };

    await controller.listPortfolio(req, res);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
