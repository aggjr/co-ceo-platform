/**
 * Importa snapshot de custódia homebroker (JSON local) para o banco.
 *
 *   npm run import:broker:snapshot -- local-import/btg-sources/custody-snapshot.json
 *   npm run import:broker:snapshot -- tests/fixtures/broker-custody-snapshot-btg-2026-05-23.json
 */
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { parseBrokerCustodySnapshotJson } from '../src/core/invest/brokerCustodySnapshotImport';
import { BrokerCustodySnapshotRepository } from '../src/core/invest/BrokerCustodySnapshotRepository';
import { installerContext } from '../src/database/seeds/lib/installerContext';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--') && a.endsWith('.json'));
  if (!fileArg) {
    console.error('Uso: npm run import:broker:snapshot -- <caminho.json>');
    console.error('Ex.: local-import/btg-sources/custody-snapshot.json');
    process.exit(1);
  }

  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(abs)) {
    console.error('Arquivo não encontrado:', abs);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const input = parseBrokerCustodySnapshotJson(raw);

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const repo = new BrokerCustodySnapshotRepository(gateway);

  const saved = await repo.upsertFromInput(ctx, input);

  console.log('=== Import snapshot custódia ===');
  console.log('Org:          ', ORG);
  console.log('Arquivo:      ', abs);
  console.log('Snapshot id:  ', saved.id);
  console.log('Data:         ', saved.referenceDate);
  console.log('Linhas:       ', saved.positions.length);
  console.log(
    '  marks:      ',
    saved.positions.filter((p) => p.lineKind === 'mark').length
  );
  console.log(
    '  pendentes:  ',
    saved.positions.filter((p) => p.lineKind !== 'mark').length
  );
  console.log('Patrimônio:   ', saved.composition.totalPatrimony.toLocaleString('pt-BR'));
  console.log('\nPróximo: npm run apply:broker:snapshot --', saved.referenceDate);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
