/**
 * Levantamento da série CDI global (market_index_daily) — compartilhada entre todos os clientes.
 *
 * Uso:
 *   npm run report:cdi
 *   npm run report:cdi -- --from=2020-01-01 --to=2026-05-22
 *   npm run report:cdi -- --sync   # busca BCB e grava faltantes antes do relatório
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { execSync } from 'child_process';
import path from 'path';
import {
  buildIndexedLevelSeries,
  periodReturnFromLevelSeries,
} from '../src/core/market/indexBenchmark';

dotenv.config();

const INDEX_CODE = 'CDI';

function parseArgs(): { from: string; to: string; sync: boolean } {
  let from = process.env.CDI_REPORT_FROM || '2020-01-01';
  let to = new Date().toISOString().slice(0, 10);
  let sync = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--sync') sync = true;
    else if (arg.startsWith('--from=')) from = arg.slice(7).slice(0, 10);
    else if (arg.startsWith('--to=')) to = arg.slice(5).slice(0, 10);
  }
  return { from, to, sync };
}

async function tableExists(conn: mysql.Connection, name: string): Promise<boolean> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

async function main() {
  const { from, to, sync } = parseArgs();

  if (sync) {
    const root = path.join(__dirname, '..');
    const cmd = `node ./node_modules/ts-node/dist/bin.js scripts/sync-market-indices.ts --from=${from} --to=${to}`;
    console.log('Sincronizando BCB → market_index_daily...\n>', cmd, '\n');
    execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_platform',
  });

  try {
    const hasTable = await tableExists(conn, 'market_index_daily');
    if (!hasTable) {
      console.log('Tabela market_index_daily ausente.');
      console.log('Aplique a migration:');
      console.log('  node scripts/run-migration.js src/database/migrations/22_market_quotes_global.sql');
      console.log('Depois: npm run sync:market:indices -- --from=' + from);
      process.exit(1);
    }

    const [summary] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n,
              MIN(reference_date) AS first_date,
              MAX(reference_date) AS last_date,
              MIN(daily_factor) AS min_factor,
              MAX(daily_factor) AS max_factor
       FROM market_index_daily
       WHERE index_code = ?`,
      [INDEX_CODE]
    );
    const s = summary[0]!;
    const total = Number(s.n ?? 0);

    console.log('=== CDI global (market_index_daily) ===');
    console.log('Escopo: sem organization_id — uma série para toda a plataforma');
    console.log('Fonte esperada: BCB SGS série 11 (bcb_sgs_11)');
    console.log(`Período consultado: ${from} → ${to}\n`);

    if (total === 0) {
      console.log('Nenhum registro CDI no banco.');
      console.log('Execute: npm run sync:market:indices -- --from=' + from + ' --to=' + to);
      process.exit(0);
    }

    console.log(`Total CDI gravado (histórico): ${total} dia(s)`);
    console.log(`Primeira data: ${s.first_date}`);
    console.log(`Última data:  ${s.last_date}`);

    const [inRange] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM market_index_daily
       WHERE index_code = ? AND reference_date >= ? AND reference_date <= ?`,
      [INDEX_CODE, from, to]
    );
    const inRangeN = Number(inRange[0]?.n ?? 0);
    console.log(`Dias com CDI no intervalo ${from}…${to}: ${inRangeN}`);

    const [byYear] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT YEAR(reference_date) AS y, COUNT(*) AS n
       FROM market_index_daily
       WHERE index_code = ?
       GROUP BY YEAR(reference_date)
       ORDER BY y`,
      [INDEX_CODE]
    );
    console.log('\nPor ano:');
    for (const row of byYear) console.log(`  ${row.y}: ${row.n} dia(s)`);

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT reference_date, daily_factor, annualized_rate, source
       FROM market_index_daily
       WHERE index_code = ? AND reference_date >= ? AND reference_date <= ?
       ORDER BY reference_date`,
      [INDEX_CODE, from, to]
    );

    const series = buildIndexedLevelSeries(
      rows.map((r) => ({
        reference_date: String(r.reference_date).slice(0, 10),
        daily_factor: Number(r.daily_factor),
      })),
      from,
      to
    );
    const periodReturn = periodReturnFromLevelSeries(series);
    if (periodReturn != null) {
      console.log(`\nRentabilidade CDI acumulada (${from} → ${to}): ${(periodReturn * 100).toFixed(4)}%`);
      console.log(`Nível indexado (base 100): ${series[0]?.level} → ${series[series.length - 1]?.level}`);
    }

    const [sources] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT source, COUNT(*) AS n FROM market_index_daily
       WHERE index_code = ? GROUP BY source ORDER BY n DESC`,
      [INDEX_CODE]
    );
    console.log('\nFontes gravadas:');
    for (const row of sources) console.log(`  ${row.source}: ${row.n}`);

    const [otherIndices] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT index_code, COUNT(*) AS n, MIN(reference_date) AS d0, MAX(reference_date) AS d1
       FROM market_index_daily
       GROUP BY index_code ORDER BY index_code`
    );
    if (otherIndices.length > 1 || (otherIndices[0] && otherIndices[0].index_code !== INDEX_CODE)) {
      console.log('\nOutros índices na mesma tabela:');
      for (const row of otherIndices) {
        console.log(`  ${row.index_code}: ${row.n} (${row.d0} … ${row.d1})`);
      }
    }

    console.log('\n--- Próximos passos ---');
    console.log('1. Backfill: npm run sync:market:indices -- --from=1990-01-01  (idempotente)');
    console.log('2. Comparar carteira: usar indexBenchmark + patrimony-daily no mesmo range');
    console.log('3. CDB % CDI: market_index_daily + parâmetros do contrato (migration 22)');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
