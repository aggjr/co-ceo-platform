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
import { fetchOptionQuotesWithFallback } from '../src/core/invest/opcoesNetQuotes';
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

  const quotes = await fetchOptionQuotesWithFallback(tickers);
  const marketQuotes = new MarketQuoteRepository(gateway);
  let saved = 0;
  const missing: string[] = [];
  const fallback: string[] = [];

  for (const ticker of tickers) {
    const q = quotes.find((x) => x.ticker === ticker);
    if (!q) {
      missing.push(ticker);
      continue;
    }
    if (q.source !== 'opcoes_net') fallback.push(ticker);
    await marketQuotes.upsertQuote(ctx, {
      ticker: q.ticker,
      quoteDate: q.asOf,
      closingPrice: q.price,
      source: q.source,
      metadata: {
        kind: 'option_last',
        scope: 'custody',
        ...(q.provider ? { provider: q.provider } : {}),
      },
    });
    saved += 1;
    const src = q.source === 'opcoes_net' ? 'opcoes.net' : `${q.provider ?? q.source}`;
    console.log(`  ${q.ticker}: R$ ${q.price} (${q.asOf}) [${src}]`);
  }

  console.log(`Gravadas: ${saved}/${tickers.length}`);
  if (fallback.length) {
    console.log(`Via fontes alternativas: ${fallback.join(', ')}`);
  }
  if (missing.length) {
    console.log(`Sem cotação em nenhuma fonte: ${missing.join(', ')}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
