import 'dotenv/config';
import mysql from 'mysql2/promise';

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function audit(label: string, host: string, user: string, password: string, database: string) {
  const conn = await mysql.createConnection({ host, user, password, database });

  console.log(`\n========== ${label} (${database} @ ${host}) ==========`);

  const tables = [
    'invest_assets',
    'invest_ledger_entries',
    'invest_daily_snapshots',
    'invest_portfolio_daily',
    'invest_options_chain',
  ];

  for (const t of tables) {
    try {
      const [totRows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) c FROM ${t}`);
      const [orgRows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) c FROM ${t} WHERE organization_id = ?`,
        [ORG]
      );
      const [activeRows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) c FROM ${t} WHERE organization_id = ? AND deleted_at IS NULL`,
        [ORG]
      ).catch(() => [[{ c: orgRows[0]!.c }]] as any);
      console.log(
        `${t.padEnd(28)} total=${String(totRows[0]!.c).padStart(6)}  org=${String(orgRows[0]!.c).padStart(6)}  ativos=${String(activeRows[0]!.c).padStart(6)}`
      );
    } catch (e) {
      console.log(`${t.padEnd(28)} ERR: ${(e as Error).message}`);
    }
  }

  console.log('\n--- invest_assets (ativos por tipo, org) ---');
  const [byType] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT asset_type, COUNT(*) c, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) ativos
     FROM invest_assets WHERE organization_id = ? GROUP BY asset_type ORDER BY c DESC`,
    [ORG]
  );
  for (const r of byType) console.log(`  ${String(r.asset_type).padEnd(14)} total=${r.c}  ativos=${r.ativos}`);

  console.log('\n--- invest_ledger_entries (lancamentos por tipo, org) ---');
  const [byTx] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT transaction_type, COUNT(*) c
     FROM invest_ledger_entries
     WHERE organization_id = ? AND deleted_at IS NULL
     GROUP BY transaction_type ORDER BY c DESC`,
    [ORG]
  );
  for (const r of byTx) console.log(`  ${String(r.transaction_type).padEnd(20)} ${r.c}`);

  console.log('\n--- Tickers em invest_assets (top 12 por quantidade) ---');
  const [tickers] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT asset_ticker, asset_type, current_quantity, managerial_avg_price, deleted_at
     FROM invest_assets WHERE organization_id = ?
     ORDER BY current_quantity DESC LIMIT 12`,
    [ORG]
  );
  for (const r of tickers) {
    console.log(
      `  ${String(r.asset_ticker).padEnd(14)} ${String(r.asset_type).padEnd(14)} qty=${r.current_quantity}  pmGer=${r.managerial_avg_price}  ${r.deleted_at ? 'DELETADO' : 'ATIVO'}`
    );
  }

  console.log('\n--- Caixa (CAIXA*) — saldo via ledger ---');
  const [cashRow] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT a.asset_ticker, SUM(e.total_net_value) saldo, COUNT(*) lancamentos
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ? AND a.asset_ticker LIKE 'CAIXA%' AND e.deleted_at IS NULL
     GROUP BY a.asset_ticker`,
    [ORG]
  );
  if (!cashRow.length) console.log('  (sem lançamentos de caixa)');
  for (const r of cashRow) console.log(`  ${r.asset_ticker}: R$ ${r.saldo}  (${r.lancamentos} lanc.)`);

  await conn.end();
}

(async () => {
  const local = process.env.DB_HOST && process.env.DB_PASSWORD !== undefined;
  if (local) {
    try {
      await audit('LOCAL', process.env.DB_HOST!, process.env.DB_USER || 'root', process.env.DB_PASSWORD!, process.env.DB_NAME || 'co_ceo_platform');
    } catch (e) {
      console.log('LOCAL skip:', (e as Error).message);
    }
  }
  const remotePw = process.env.REMOTE_DB_PASSWORD;
  if (remotePw) {
    await audit('SERVER', process.env.REMOTE_DB_HOST || '69.62.99.34', 'root', remotePw, 'co_ceo_platform');
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
