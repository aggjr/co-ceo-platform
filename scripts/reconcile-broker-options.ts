/**
 * Cruza opções do snapshot BTG (imagens) com custódia/livro e opcoes.net.
 *
 *   npx ts-node scripts/reconcile-broker-options.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { InvestAssetProjection } from '../src/modules/invest/sync/InvestAssetProjection';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { BrokerCustodySnapshotRepository } from '../src/core/invest/BrokerCustodySnapshotRepository';
import {
  marksFromSnapshotLines,
  type BrokerPositionMark,
} from '../src/core/invest/brokerCustodySnapshotTypes';
import { inferAssetType } from '../src/core/invest/assetClassifier';
import { fetchOpcoesNetOptionsChainAll } from '../src/core/invest/opcoesNetClient';
import { b3OptionTickerFromOpcoesNetSuffix } from '../src/core/invest/opcoesNetChainParser';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const TO = process.env.PATRIMONY_TO || '2026-05-23';

function isOptionTicker(t: string): boolean {
  const type = inferAssetType(t);
  return type === 'option_call' || type === 'option_put';
}

async function loadOpcoesNetTickers(underlyings: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const u of underlyings) {
    try {
      const expirations = await fetchOpcoesNetOptionsChainAll(u);
      for (const exp of expirations) {
        for (const row of [...exp.calls, ...exp.puts]) {
          if (!Array.isArray(row) || row.length < 1) continue;
          const suffix = String(row[0] ?? '').trim();
          if (!suffix) continue;
          const ticker = b3OptionTickerFromOpcoesNetSuffix(u, suffix);
          if (ticker) found.add(ticker.toUpperCase());
        }
      }
    } catch (e) {
      console.warn(`  opcoes.net ${u}:`, (e as Error).message);
    }
  }
  return found;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const projection = new InvestAssetProjection(gateway);
  const ledger = new LedgerImportService(gateway);
  const assets = await projection.listActiveAssets(ctx);
  const events = await ledger.listLedgerEvents(ctx, '2026-01-01', TO);

  const bookByTicker = new Map<string, { qty: number; value: number }>();
  for (const a of assets) {
    const t = String(a.asset_ticker ?? '').toUpperCase();
    if (!isOptionTicker(t)) continue;
    bookByTicker.set(t, {
      qty: Number(a.current_quantity),
      value: Number(a.current_value ?? 0),
    });
  }

  const snapRepo = new BrokerCustodySnapshotRepository(gateway);
  const snapshot =
    (await snapRepo.loadByReferenceDate(ctx, TO)) ?? (await snapRepo.loadLatest(ctx));
  if (!snapshot) {
    console.error(
      'Nenhum snapshot BTG no banco. Importe: npm run import:broker:snapshot -- <json>'
    );
    process.exit(1);
  }
  const brokerMarks = marksFromSnapshotLines(snapshot.positions);
  const brokerMap = new Map(brokerMarks.map((m) => [m.ticker.toUpperCase(), m]));

  const missingInBook: BrokerPositionMark[] = [];
  const qtyMismatch: Array<{
    ticker: string;
    brokerQty: number;
    bookQty: number;
    brokerVal: number;
    bookVal: number;
  }> = [];
  const matched: string[] = [];

  for (const m of brokerMarks) {
    const t = m.ticker.toUpperCase();
    const book = bookByTicker.get(t);
    if (!book) {
      missingInBook.push(m);
      continue;
    }
    if (Math.abs(book.qty - m.quantity) > 0.01) {
      qtyMismatch.push({
        ticker: t,
        brokerQty: m.quantity,
        bookQty: book.qty,
        brokerVal: m.marketValue,
        bookVal: book.value,
      });
    } else {
      matched.push(t);
    }
    bookByTicker.delete(t);
  }

  const extraInBook = [...bookByTicker.entries()]
    .filter(([, v]) => Math.abs(v.qty) > 0.01)
    .sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value));

  // Vendas recentes no livro (sell option) sem posição na corretora
  const OPTION_SELL_TYPES = new Set(['sell', 'call_sell', 'put_sell']);
  const recentSells = events.filter((e) => {
    const t = String(e.asset_ticker ?? '').toUpperCase();
    if (!isOptionTicker(t)) return false;
    if (!OPTION_SELL_TYPES.has(String(e.transaction_type))) return false;
    const d = String(e.transaction_date).slice(0, 10);
    return d >= '2026-05-01';
  });

  const sellsByTicker = new Map<string, typeof recentSells>();
  for (const e of recentSells) {
    const t = String(e.asset_ticker).toUpperCase();
    if (!sellsByTicker.has(t)) sellsByTicker.set(t, []);
    sellsByTicker.get(t)!.push(e);
  }

  console.log('=== Reconciliação opções BTG vs livro ===\n');
  console.log('Org:', ORG, '| Até:', TO);
  console.log('Corretora (snapshot banco):', brokerMarks.length, 'linhas | data', snapshot.referenceDate);
  console.log('Livro (posição ≠ 0):', assets.filter((a) => isOptionTicker(String(a.asset_ticker))).length);
  console.log('');

  console.log('--- Na corretora, AUSENTES no livro (provável venda não lançada ou ticker novo) ---');
  if (missingInBook.length === 0) {
    console.log('  (nenhum)');
  } else {
    let sumVol = 0;
    for (const m of missingInBook) {
      sumVol += m.marketValue;
      console.log(
        `  ${m.ticker.padEnd(12)} qtd=${String(m.quantity).padStart(6)}  preço=${m.lastPrice.toFixed(2).padStart(5)}  vol=${m.marketValue.toLocaleString('pt-BR')}`
      );
    }
    console.log('  Soma volume BTG ausente:', sumVol.toLocaleString('pt-BR'));
  }
  console.log('');

  console.log('--- Na corretora, qty DIVERGENTE no livro ---');
  if (qtyMismatch.length === 0) {
    console.log('  (nenhum)');
  } else {
    for (const r of qtyMismatch) {
      console.log(
        `  ${r.ticker.padEnd(12)} BTG=${r.brokerQty} livro=${r.bookQty}  vol BTG=${r.brokerVal.toLocaleString('pt-BR')} livro=${r.bookVal.toLocaleString('pt-BR')}`
      );
    }
  }
  console.log('');

  console.log('--- No livro, NÃO na corretora (posição fantasma / já encerrada na BTG) ---');
  console.log(`  Total: ${extraInBook.length} tickers com qty ≠ 0`);
  for (const [t, v] of extraInBook.slice(0, 25)) {
    console.log(`  ${t.padEnd(12)} qtd=${String(v.qty).padStart(7)}  current_value=${v.value.toLocaleString('pt-BR')}`);
  }
  if (extraInBook.length > 25) console.log(`  ... +${extraInBook.length - 25} mais`);
  const extraSum = extraInBook.reduce((s, [, v]) => s + v.value, 0);
  console.log('  Soma current_value (top/all):', extraSum.toLocaleString('pt-BR'));
  console.log('');

  console.log('--- Vendas de opção no livro (mai/2026) em ticker AUSENTE na corretora ---');
  const sellsNotInBroker: Array<{ ticker: string; date: string; qty: number; price: number }> = [];
  for (const [t, evs] of sellsByTicker) {
    if (brokerMap.has(t)) continue;
    for (const e of evs) {
      sellsNotInBroker.push({
        ticker: t,
        date: String(e.transaction_date).slice(0, 10),
        qty: Number(e.quantity),
        price: Number(e.unit_price),
      });
    }
  }
  if (sellsNotInBroker.length === 0) {
    console.log('  (nenhuma venda recente só no livro)');
  } else {
    for (const s of sellsNotInBroker.slice(0, 30)) {
      console.log(`  ${s.date} ${s.ticker.padEnd(12)} sell qty=${s.qty} @ ${s.price}`);
    }
  }
  console.log('');

  console.log('--- Vendas no livro para tickers que ESTÃO na corretora (conferência) ---');
  for (const m of brokerMarks) {
    const t = m.ticker.toUpperCase();
    const evs = sellsByTicker.get(t);
    if (!evs?.length) continue;
    const last = evs[evs.length - 1]!;
    console.log(
      `  ${t.padEnd(12)} última sell ${String(last.transaction_date).slice(0, 10)} qty=${last.quantity} (custódia BTG=${m.quantity})`
    );
  }
  console.log('');

  console.log('--- opcoes.net (cadeia B3) — tickers do snapshot existem na web? ---');
  const underlyings = ['BBAS3', 'ITUB4', 'PRIO3', 'WEGE3'];
  const webTickers = await loadOpcoesNetTickers(underlyings);
  const notOnWeb: string[] = [];
  const onWebMissingBook: string[] = [];
  for (const m of brokerMarks) {
    const t = m.ticker.toUpperCase();
    const aliases = t === 'WEGER441' ? ['WEGER441', 'WEGER41'] : [t];
    const onWeb = aliases.some((a) => webTickers.has(a));
    if (!onWeb) notOnWeb.push(t);
    else if (missingInBook.some((x) => x.ticker.toUpperCase() === t)) onWebMissingBook.push(t);
  }
  console.log('  Tickers na cadeia opcoes.net:', webTickers.size);
  if (notOnWeb.length) {
    console.log('  Não encontrados na cadeia (sufixo/ticker):', notOnWeb.join(', '));
  } else {
    console.log('  Todos os tickers do snapshot constam na cadeia opcoes.net.');
  }
  if (onWebMissingBook.length) {
    console.log('  Na web E na corretora, mas SEM lançamento no livro:');
    for (const t of onWebMissingBook) {
      const m = brokerMap.get(t)!;
      console.log(`    ${t}  qtd=${m.quantity}  (válido B3 — falta importar nota/extrato)`);
    }
  }

  console.log('\n--- Resumo ---');
  console.log('  Alinhados (qty):', matched.length);
  console.log('  Faltam no livro:', missingInBook.length);
  console.log('  Qty divergente:', qtyMismatch.length);
  console.log('  Só no livro:', extraInBook.length);
  console.log(
    '  Derivativos BTG (snapshot):',
    snapshot.composition.derivatives.toLocaleString('pt-BR'),
    '| marks aplicados:',
    brokerMarks.reduce((s, m) => s + m.marketValue, 0).toLocaleString('pt-BR')
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
