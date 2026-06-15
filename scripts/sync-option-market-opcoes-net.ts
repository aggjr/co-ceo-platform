/**
 * Sincroniza strikes/vencimentos de opções vigentes do opcoes.net.br
 * para invest_options_market (cache global).
 *
 * Agendar de madrugada (ex.: 03:15) após o site publicar a grade do dia.
 *
 * Uso:
 *   npm run sync:options:market
 *   npm run sync:options:market -- PRIO3 ITUB4
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { OptionMarketSyncService } from '../src/core/invest/OptionMarketSyncService';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const forceRefresh = args.includes('--force');
  const explicitUnderlyings = args
    .map((a) => a.trim().toUpperCase())
    .filter((a) => a && !a.startsWith('--'));

  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });
  console.log(`Banco: ${host}`);

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const service = new OptionMarketSyncService(gateway);

  const report = await service.syncFromOpcoesNet(ctx, {
    underlyings: explicitUnderlyings.length ? explicitUnderlyings : undefined,
    onlyMissingContracts: !forceRefresh,
    pruneUnused: true,
  });

  console.log('Sincronizacao opcoes.net -> invest_options_market');
  console.log(`  Acoes-mae: ${report.underlyings.join(', ') || '(nenhuma)'}`);
  console.log(`  Tickers do(s) cliente(s): ${report.tickersInUse.join(', ') || '(nenhum)'}`);
  console.log(`  Linhas parseadas (vigentes): ${report.rowsParsed}`);
  console.log(`  Linhas mantidas no catalogo: ${report.rowsKept}`);
  console.log(`  Contratos ja conhecidos: ${report.contractsAlreadyKnown ?? 0}`);
  console.log(`  Inseridas: ${report.inserted}  Atualizadas: ${report.updated}`);
  console.log(`  Antigas removidas: ${report.pruned ?? 0}`);
  if (report.errors.length) {
    console.log('  Erros:');
    for (const e of report.errors) {
      console.log(`    ${e.underlying}: ${e.message}`);
    }
    await pool.end();
    process.exit(1);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
