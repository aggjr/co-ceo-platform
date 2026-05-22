/*
 * Conta linhas em todas as tabelas INVEST relevantes para reset+replay.
 * Apenas leitura.
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   node scripts/inspect-invest-state.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

const TABLES_BY_ORG = [
  'business_events',
  'patrimony_ledger_entries',
  'financial_ledger_entries',
  'patrimony_items',
  'financial_accounts',
  'invest_position_ext',
  'invest_option_ext',
  'invest_daily_snapshots',
  'invest_portfolio_daily',
];

const TABLES_GLOBAL = [
  // IAM / catalog — checagem de paridade para garantir que NAO serao tocadas.
  'users',
  'roles',
  'permissions',
  'organizations',
  'contracts',
  'user_roles',
];

async function main() {
  const host = process.env.REMOTE_DB_HOST || '69.62.99.34';
  const conn = await mysql.createConnection({
    host,
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  console.log(`\n=== Tabelas escopadas em org=${ORG_ID} ===`);
  for (const t of TABLES_BY_ORG) {
    try {
      const [active] = await conn.query(
        `SELECT COUNT(*) c FROM \`${t}\` WHERE organization_id = ? AND deleted_at IS NULL`,
        [ORG_ID]
      );
      const [softDeleted] = await conn.query(
        `SELECT COUNT(*) c FROM \`${t}\` WHERE organization_id = ? AND deleted_at IS NOT NULL`,
        [ORG_ID]
      );
      console.log(
        `  ${t.padEnd(28)} ativos=${String(active[0].c).padStart(6)}  soft-del=${softDeleted[0].c}`
      );
    } catch (err) {
      console.log(`  ${t.padEnd(28)} ERR ${err.message}`);
    }
  }

  console.log(`\n=== Tabelas globais (so leitura, NAO sao tocadas) ===`);
  for (const t of TABLES_GLOBAL) {
    try {
      const [r] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
      console.log(`  ${t.padEnd(28)} ${r[0].c}`);
    } catch (err) {
      console.log(`  ${t.padEnd(28)} ERR ${err.message}`);
    }
  }

  console.log(`\n=== Patrimony items por ticker (org=${ORG_ID}) ===`);
  const [items] = await conn.query(
    `SELECT identifier, subcategory, quantity, acquisition_value, status
       FROM patrimony_items
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY identifier`,
    [ORG_ID]
  );
  for (const it of items) {
    console.log(
      `  ${String(it.identifier).padEnd(20)} ${String(it.subcategory).padEnd(14)} qty=${it.quantity}  acq=${it.acquisition_value}  status=${it.status}`
    );
  }

  console.log(`\n=== Headers business_events (org=${ORG_ID}) ===`);
  const [headers] = await conn.query(
    `SELECT event_kind, source_ref, COUNT(*) c
       FROM business_events
      WHERE organization_id = ? AND deleted_at IS NULL
      GROUP BY event_kind, source_ref
      ORDER BY event_kind, source_ref`,
    [ORG_ID]
  );
  for (const h of headers) {
    console.log(
      `  ${String(h.event_kind).padEnd(20)} ${String(h.source_ref || '(null)').padEnd(40)} count=${h.c}`
    );
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
