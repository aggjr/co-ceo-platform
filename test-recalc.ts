import { config } from 'dotenv';
config();
import db from './src/config/database';
import { CoCeoDataGateway } from './src/core/dal/CoCeoDataGateway';
import { InvestAssetProjection } from './src/modules/invest/sync/InvestAssetProjection';

async function run() {
  try {
    const gateway = new CoCeoDataGateway(db);
    const projection = new InvestAssetProjection(gateway);
    const orgId = '14eb3115-38b4-4bca-85f0-f9bd0ec3dded'; // Assuming we'll query the correct orgId

    const [orgs] = await db.query('SELECT id FROM organizations LIMIT 1');
    const actualOrgId = (orgs as any)[0]?.id;

    const ctx: any = { organizationId: actualOrgId, roleId: 'admin', scope: 'tenant' };
    const assets = await projection.listActiveAssets(ctx);
    
    console.log('ITUB4:', assets.find((a: any) => a.asset_ticker === 'ITUB4'));
    console.log('PRIO3:', assets.find((a: any) => a.asset_ticker === 'PRIO3'));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
