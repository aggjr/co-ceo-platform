/**
 * Atualiza cotações de ações/FIIs via brapi.dev.
 *
 * Uso (fechamento de ontem — padrão para gravar no dia seguinte):
 *   node ./node_modules/ts-node/dist/bin.js scripts/fetch-b3-quotes.ts
 *   node ./node_modules/ts-node/dist/bin.js scripts/fetch-b3-quotes.ts 2026-05-19
 *
 * Token: BRAPI_TOKEN no .env (https://brapi.dev — plano gratuito com limite diário).
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { InvestQuoteSyncService } from '../src/core/invest/InvestQuoteSyncService';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function defaultClosingDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const asOf = process.argv[2]?.slice(0, 10) || defaultClosingDate();

  if (!process.env.BRAPI_TOKEN) {
    console.warn(
      'AVISO: BRAPI_TOKEN não definido — só PETR4, VALE3, MGLU3, ITUB4 funcionam sem token.'
    );
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const sync = new InvestQuoteSyncService(gateway);

  const result = await sync.syncFromBrapi(ctx, asOf);
  console.log('Data fechamento:', asOf);
  console.log('Tickers pedidos:', result.requested);
  console.log('Atualizados:', result.updated);
  if (result.missing.length) {
    console.log('Sem cotação brapi:', result.missing.join(', '));
  }
  console.log('\nOpções: ainda use snapshot BTG (sync-necton) ou --snapshot no daily-invest-close.');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
