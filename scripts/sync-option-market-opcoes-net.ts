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
  const explicitUnderlyings = process.argv
    .slice(2)
    .map((a) => a.trim().toUpperCase())
    .filter((a) => a && !a.startsWith('--'));

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const service = new OptionMarketSyncService(gateway);

  const report = await service.syncFromOpcoesNet(ctx, {
    underlyings: explicitUnderlyings.length ? explicitUnderlyings : undefined,
  });

  console.log('Sincronização opcoes.net → invest_options_market');
  console.log(`  Ações-mãe: ${report.underlyings.join(', ') || '(nenhuma)'}`);
  console.log(`  Linhas parseadas (vigentes): ${report.rowsParsed}`);
  console.log(`  Inseridas: ${report.inserted}  Atualizadas: ${report.updated}`);
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
