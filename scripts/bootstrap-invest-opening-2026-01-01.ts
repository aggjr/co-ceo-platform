/**
 * Script de bootstrap: importa a abertura 01/01/2026 da holding usando o
 * novo nucleo patrimonial canonico. Deve rodar UMA vez por base de dados.
 *
 * Pre-requisitos no servidor (todos satisfeitos pelas migrations 11-14):
 *   - patrimony_items, patrimony_locations, patrimony_item_locations,
 *     patrimony_ledger_entries
 *   - financial_accounts, financial_ledger_entries
 *   - module_categories com seeds do INVEST
 *   - invest_position_ext, invest_option_ext
 *
 * Comportamento: idempotente. Se ja existirem registros (CAIXA-BTG, PRIO3
 * etc.) ele apenas reaproveita os ids — nao duplica.
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD = "<...>"
 *   npx ts-node scripts/bootstrap-invest-opening-2026-01-01.ts
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../src/core/dal/types';
import { buildInvestOperations } from '../src/modules/invest';
import type { UserContext } from '../src/core/dal';
import type { OpeningBatchInput } from '../src/modules/invest';

const ORG_ID = 'org-holding-001';
const AS_OF = '2026-01-01';

const BATCH: OpeningBatchInput = {
  asOfDate: AS_OF,
  positions: [
    {
      ticker: 'PRIO3',
      assetClass: 'stock',
      quantity: 5400,
      unitPrice: 38.33,
      name: 'Prio S.A.',
    },
    {
      ticker: 'TESOURO-LFT-BTG',
      assetClass: 'fixed_income',
      quantity: 1,
      unitPrice: 1_000_341.65,
      name: 'Tesouro LFT (BTG)',
    },
    {
      ticker: 'PRIOQ43',
      assetClass: 'option_put',
      quantity: -31_200,
      unitPrice: 1.426748,
      optionUnderlying: 'PRIO3',
      optionStrike: 43,
      optionExpiration: '2026-05-15',
      optionType: 'PUT',
    },
    {
      ticker: 'PRIOR407',
      assetClass: 'option_put',
      quantity: -6_300,
      unitPrice: 0.912254,
      optionUnderlying: 'PRIO3',
      optionStrike: 40.7,
      optionExpiration: '2026-06-19',
      optionType: 'PUT',
    },
    {
      ticker: 'PRIOA407',
      assetClass: 'option_call',
      quantity: -5_400,
      unitPrice: 0.626905,
      optionUnderlying: 'PRIO3',
      optionStrike: 40.7,
      optionExpiration: '2026-01-16',
      optionType: 'CALL',
    },
  ],
  cashAccounts: [
    {
      brokerCode: 'BTG',
      accountName: 'Caixa investimento BTG',
      externalId: 'BTG',
      balance: 58_758.79,
    },
  ],
};

const EXPECTED_PATRIMONY = 1_212_435.42;

async function purgeOrgData(conn: mysql.Connection): Promise<void> {
  console.log(`Limpando dados de INVEST da organizacao ${ORG_ID} (ambos os schemas)...`);

  await conn.query(
    `DELETE FROM financial_ledger_entries WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM financial_closings WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM financial_accounts WHERE organization_id = ?`,
    [ORG_ID]
  );

  await conn.query(
    `DELETE FROM patrimony_ledger_entries WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM patrimony_item_locations WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM patrimony_closings WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM invest_option_ext WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM invest_position_ext WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM patrimony_items WHERE organization_id = ?`,
    [ORG_ID]
  );

  await conn.query(
    `DELETE FROM invest_ledger_entries WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM invest_daily_snapshots WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM invest_portfolio_daily WHERE organization_id = ?`,
    [ORG_ID]
  );
  await conn.query(
    `DELETE FROM invest_assets WHERE organization_id = ?`,
    [ORG_ID]
  );

  const [check] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM patrimony_items WHERE organization_id = ?) AS pi,
       (SELECT COUNT(*) FROM patrimony_ledger_entries WHERE organization_id = ?) AS pl,
       (SELECT COUNT(*) FROM financial_accounts WHERE organization_id = ?) AS fa,
       (SELECT COUNT(*) FROM financial_ledger_entries WHERE organization_id = ?) AS fl,
       (SELECT COUNT(*) FROM invest_assets WHERE organization_id = ?) AS ia,
       (SELECT COUNT(*) FROM invest_ledger_entries WHERE organization_id = ?) AS il`,
    [ORG_ID, ORG_ID, ORG_ID, ORG_ID, ORG_ID, ORG_ID]
  );
  const row = check[0];
  const total =
    Number(row.pi) +
    Number(row.pl) +
    Number(row.fa) +
    Number(row.fl) +
    Number(row.ia) +
    Number(row.il);
  if (total > 0) {
    throw new Error(
      `Purge incompleto: ${JSON.stringify(row)}. Verifique constraints.`
    );
  }
  console.log('Estado limpo confirmado.');
}

async function main(): Promise<void> {
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD!,
    database: 'co_ceo_platform',
    waitForConnections: true,
    connectionLimit: 4,
    timezone: '+00:00',
  });

  const conn = await pool.getConnection();
  try {
    await purgeOrgData(conn);
  } finally {
    conn.release();
  }

  const gateway = new CoCeoDataGateway(pool);
  const ops = buildInvestOperations(gateway);

  const ctx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: ORG_ID,
    impersonatorId: null,
    scope: 'global',
  };

  console.log(`\nRodando recordOpeningBatch (asOf=${AS_OF}, org=${ORG_ID})...`);
  const result = await ops.recordOpeningBatch(ctx, BATCH);

  console.log('\nResultado:');
  console.log(`  patrimony_items criados : ${result.patrimonyItemsCreated}`);
  console.log(`  ledger entries criados  : ${result.ledgerEntriesCreated}`);
  console.log(`  contas de caixa criadas : ${result.cashAccountsCreated}`);
  console.log(`  lancamentos de caixa    : ${result.cashEntriesCreated}`);
  console.log(`  longs                   : R$ ${result.longsValue.toFixed(2)}`);
  console.log(`  shorts                  : R$ ${result.shortsValue.toFixed(2)}`);
  console.log(`  caixa                   : R$ ${result.cashTotal.toFixed(2)}`);
  console.log(`  PATRIMONIO              : R$ ${result.totalPatrimony.toFixed(2)}`);
  console.log(`  esperado                : R$ ${EXPECTED_PATRIMONY.toFixed(2)}`);

  const diff = Math.abs(result.totalPatrimony - EXPECTED_PATRIMONY);
  if (diff > 0.05) {
    console.error(
      `\nERRO: diferenca de R$ ${diff.toFixed(2)} acima da tolerancia (R$ 0,05).`
    );
    process.exit(1);
  }
  console.log(`\nOK. Diferenca de R$ ${diff.toFixed(2)} (arredondamento aceitavel).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
