import { PatrimonyMonthlyAnchorsRepository } from './src/core/invest/PatrimonyMonthlyAnchorsRepository';
import { initializeGateway } from './src/core/dal/initializeGateway';
import { SYSTEM_INSTALLER_USER_ID } from './src/core/dal/types';

async function main() {
  const gateway = await initializeGateway();
  const repo = new PatrimonyMonthlyAnchorsRepository(gateway);
  const ctx = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: 'org-holding-001',
    impersonatorId: null,
    scope: 'node' as const,
  };
  
  const anchors = await repo.loadForOrganization(ctx);
  console.log('Anchors for org-holding-001:', JSON.stringify(anchors, null, 2));
  
  process.exit(0);
}

main().catch(console.error);
