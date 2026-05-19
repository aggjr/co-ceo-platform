/**
 * Aplica correções autorizadas (CDB, extrato 18–19/05, PRIOF, saldo caixa).
 * Uso: npx ts-node scripts/invest-apply-corrections.ts
 */
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../src/core/dal';
import { CustodyCorrectionService } from '../src/core/invest/CustodyCorrectionService';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { installerContext } from '../src/database/seeds/lib/installerContext';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const gateway = new CoCeoDataGateway();
  const ctx = installerContext(ORG_ID);
  const ledger = new LedgerImportService(gateway);
  const corrections = new CustodyCorrectionService(gateway, ledger);
  const result = await corrections.applyAuthorizedCorrections(ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
