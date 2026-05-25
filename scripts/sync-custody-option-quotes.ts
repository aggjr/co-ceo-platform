/**
 * Cotações opcoes.net apenas para opções em custódia aberta (não grava a grade inteira).
 *
 * Uso:
 *   npm run sync:options:custody
 *   npm run sync:options:custody -- org-holding-001
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { fetchOpcoesNetOptionQuotes } from '../src/core/invest/opcoesNetQuotes';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';

dotenv.config();

async function main() {
  const orgId = process.argv
    .slice(2)
    .map((a) => a.trim())
    .find((a) => a && !a.startsWith('--'));

  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });
  console.log(`Banco: ${host}`);
  if (orgId) console.log(`Organização: ${orgId}`);

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const queryName = orgId
    ? 'invest_open_option_tickers_for_org'
    : 'invest_open_option_tickers';
  const params = orgId ? [orgId] : [];
  const rows = await gateway.readQuery(ctx, queryName, params);
  const tickers = rows
    .map((r) => String(r.ticker ?? '').trim().toUpperCase())
    .filter(Boolean);

  if (!tickers.length) {
    console.log('Nenhuma opção em custódia aberta.');
    await pool.end();
    return;
  }

  console.log(`Opções em carteira: ${tickers.length}`);
  console.log(tickers.join(', '));

  const quotes = await fetchOpcoesNetOptionQuotes(tickers);
  const marketQuotes = new MarketQuoteRepository(gateway);
  let saved = 0;
  const missing: string[] = [];

  for (const ticker of tickers) {
    const q = quotes.find((x) => x.ticker === ticker);
    if (!q) {
      missing.push(ticker);
      continue;
    }
    await marketQuotes.upsertQuote(ctx, {
      ticker: q.ticker,
      quoteDate: q.asOf,
      closingPrice: q.price,
      source: 'opcoes_net',
      metadata: { kind: 'option_last', scope: 'custody' },
    });
    saved += 1;
    console.log(`  ${q.ticker}: R$ ${q.price} (${q.asOf})`);
  }

  console.log(`Gravadas: ${saved}/${tickers.length}`);
  if (missing.length) {
    console.log(`Sem cotação na grade: ${missing.join(', ')}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
