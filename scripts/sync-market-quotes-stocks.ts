/**
 * Sincroniza cotações de fechamento (brapi) para todos os tickers de ações/FIIs/ETF/BDR
 * em uso por qualquer cliente, gravando em market_quotes_daily (global, único para todos).
 *
 * Roda 1x/dia (cron noturno) — substitui as chamadas brapi por cliente do legado.
 *
 * Uso:
 *   npm run sync:market:quotes:stocks
 *   npm run sync:market:quotes:stocks -- 2026-05-20    # data específica (último pregão útil)
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';
import { fetchB3Quotes } from '../src/core/invest/B3QuoteProvider';

dotenv.config();

const dateArg = process.argv[2]?.slice(0, 10);

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_platform',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const repo = new MarketQuoteRepository(gateway);

  const tickers = await repo.listTickersInUse(ctx);
  if (!tickers.length) {
    console.log('Nenhum ticker em uso (patrimony_items vazio para INVEST).');
    await pool.end();
    return;
  }
  console.log(`Sincronizando ${tickers.length} ticker(s) único(s) em uso por algum cliente.`);

  const quotes = await fetchB3Quotes(tickers, {
    asOfDate: dateArg,
    token: process.env.BRAPI_TOKEN,
  });
  console.log(`brapi devolveu ${quotes.length} cotação(ões).`);

  let saved = 0;
  for (const q of quotes) {
    await repo.upsertQuote(ctx, {
      ticker: q.ticker,
      quoteDate: q.asOf,
      closingPrice: q.price,
      source: 'brapi',
      metadata: { kind: q.kind },
    });
    saved += 1;
  }
  console.log(`Gravados em market_quotes_daily: ${saved}`);

  const got = new Set(quotes.map((q) => q.ticker));
  const missing = tickers.filter((t) => !got.has(t));
  if (missing.length) {
    console.log('Sem cotação (verificar ticker):', missing.join(', '));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
