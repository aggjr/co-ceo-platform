import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { LedgerEventProjection } from '../src/modules/invest/sync/LedgerEventProjection';
import { previewBtgMonthImport } from '../src/core/invest/btgMonthImportService';
import { InvestOperations } from '../src/modules/invest';
import fs from 'fs';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const gw = new CoCeoDataGateway(pool);
  const proj = new LedgerEventProjection(gw);
  const ops = new InvestOperations(gw);
  
  const ctx = { organizationId: 'org-holding-001' } as any;
  const deps = { gateway: gw, projection: proj, operations: ops } as any;
  
  const dir = 'G:/Meu Drive/01 - Nova Estrutura';
  const month = '2026-05';
  
  const files: any[] = [];
  files.push({
    name: 'Mai_2026.pdf',
    buffer: fs.readFileSync(`${dir}/Mai_2026.pdf`),
    size: 1000
  });
  
  const notasDir = `${dir}/Notas Corretagem/004176105_20260426_20260525`;
  if (fs.existsSync(notasDir)) {
    for (const f of fs.readdirSync(notasDir)) {
      if (f.endsWith('.pdf')) {
        files.push({
          name: f,
          buffer: fs.readFileSync(`${notasDir}/${f}`),
          size: 1000
        });
      }
    }
  }

  const res = await previewBtgMonthImport(ctx, month, files, deps);
  console.log('May Preview:', JSON.stringify(res, null, 2));
  
  await pool.end();
}

main().catch(console.error);
