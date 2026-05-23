/**
 * Popula benchmarks globais usados no gráfico Resultado Histórico:
 *   - CDI (BCB) em market_index_daily
 *   - PRIO3 ou INVEST_CHART_BENCHMARK_TICKER em market_quotes_daily
 *
 * Idempotente — pode rodar após migration 22 e em cron.
 *
 * Uso:
 *   npm run seed:market:benchmarks
 *   npm run seed:market:benchmarks -- --from=2025-12-01
 */
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const TS = path.join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
const from =
  process.argv.find((a) => a.startsWith('--from='))?.slice(7).slice(0, 10) ||
  process.env.MARKET_INDEX_SYNC_FROM ||
  '2025-12-01';
const to = new Date().toISOString().slice(0, 10);
const ticker = (process.env.INVEST_CHART_BENCHMARK_TICKER || 'PRIO3').toUpperCase();

function run(script: string, args: string[] = []) {
  const cmd = [process.execPath, TS, path.join(__dirname, script), ...args]
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(' ');
  console.log('>', cmd);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

function main() {
  console.log(`Benchmarks: CDI ${from} → ${to}, ação ${ticker}\n`);
  run('sync-market-indices.ts', [`--from=${from}`, `--to=${to}`]);
  run('backfill-market-quotes-history.ts', [
    `--from=${from}`,
    `--to=${to}`,
    `--tickers=${ticker}`,
  ]);
  console.log('\nOK. Abra Resultado Histórico e atualize o gráfico.');
}

main();
