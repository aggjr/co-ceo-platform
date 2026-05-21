/**
 * Conferência: patrimônio em 01/01/2026 = custódia (abertura) + caixa.
 * Não grava no banco — só simula o motor de patrimônio do livro.
 *
 * Uso:
 *   npx ts-node scripts/validate-opening-patrimony.ts
 *   npx ts-node scripts/validate-opening-patrimony.ts data/invest/opening-ir-2026-01-01.json 1212435.41
 */
import fs from 'fs';
import path from 'path';
import type { OpeningImportPayload } from '../src/core/invest/ledgerTypes';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { fixedIncomeTotalFromLedger } from '../src/core/invest/patrimonyLedgerGates';
import { inferAssetType, inferUnderlyingTicker } from '../src/core/invest/assetClassifier';

const DEFAULT_FILE = path.join(
  __dirname,
  '..',
  'data',
  'invest',
  'opening-ir-2026-01-01.json'
);
const DEFAULT_TARGET = 1_212_435.41;
const OPENING_DATE = '2026-01-01';

function openingToLedgerEvents(payload: OpeningImportPayload): LedgerEvent[] {
  const date = payload.opening_date || OPENING_DATE;
  const events: LedgerEvent[] = [];
  let seq = 0;
  const nextId = () => `open-sim-${++seq}`;

  for (const pos of payload.opening_positions || []) {
    const ticker = pos.ticker.trim().toUpperCase();
    const assetType = pos.asset_type || inferAssetType(ticker);
    const qty = Math.abs(Number(pos.quantity));
    const price = Number(pos.avg_price);
    events.push({
      id: nextId(),
      asset_id: `asset-${ticker}`,
      asset_ticker: ticker,
      asset_type: assetType,
      underlying_ticker: inferUnderlyingTicker(ticker, pos.underlying_ticker),
      transaction_type: 'opening_balance',
      transaction_date: date,
      quantity: qty,
      unit_price: price,
      total_net_value: -(qty * price),
      impacts_managerial_price: true,
    });
  }

  for (const line of payload.opening_short_options || []) {
    const ticker = line.ticker.trim().toUpperCase();
    const assetType = inferAssetType(ticker);
    const qty = -Math.abs(Number(line.quantity));
    const price = Number(line.unit_price);
    events.push({
      id: nextId(),
      asset_id: `asset-${ticker}`,
      asset_ticker: ticker,
      asset_type: assetType,
      underlying_ticker: inferUnderlyingTicker(ticker, line.underlying_ticker),
      transaction_type: line.operation,
      transaction_date: date,
      quantity: qty,
      unit_price: price,
      total_net_value: Math.abs(qty) * price,
      impacts_managerial_price: true,
    });
  }

  return events;
}

function sumOpeningLines(payload: OpeningImportPayload) {
  let longValue = 0;
  let shortPremium = 0;
  let cash = 0;
  const lines: Array<{ kind: string; ticker: string; value: number }> = [];

  for (const p of payload.opening_positions || []) {
    const v = Math.abs(Number(p.quantity)) * Number(p.avg_price);
    if (String(p.ticker).toUpperCase().startsWith('CAIXA')) {
      cash += v;
      lines.push({ kind: 'caixa', ticker: p.ticker, value: v });
    } else {
      longValue += v;
      lines.push({ kind: 'ativo', ticker: p.ticker, value: v });
    }
  }

  for (const s of payload.opening_short_options || []) {
    const v = Math.abs(Number(s.quantity)) * Number(s.unit_price);
    shortPremium += v;
    lines.push({ kind: 'short-opção', ticker: s.ticker, value: v });
  }

  return { longValue, shortPremium, cash, lines };
}

function main() {
  const file = path.resolve(process.argv[2] || DEFAULT_FILE);
  const target = Number(process.argv[3] || DEFAULT_TARGET);
  if (!fs.existsSync(file)) {
    console.error('Arquivo não encontrado:', file);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as OpeningImportPayload & {
    target_patrimony?: number;
  };
  const targetPatrimony = Number.isFinite(target) ? target : payload.target_patrimony ?? DEFAULT_TARGET;

  const sums = sumOpeningLines(payload);
  const events = openingToLedgerEvents(payload);
  const stockQuotes: Record<string, number> = {};
  for (const p of payload.opening_positions || []) {
    const t = p.ticker.trim().toUpperCase();
    const at = p.asset_type || inferAssetType(t);
    if (at === 'stock' || at === 'fii') stockQuotes[t] = Number(p.avg_price);
  }
  const mtm = buildDailyPatrimonyMtmSeries(events, OPENING_DATE, OPENING_DATE, {
    calibrateToAnchors: false,
    fixedIncomeTotal: fixedIncomeTotalFromLedger(events),
    stockQuotes,
  });
  const point = mtm.series[0];
  const enginePatrimony = point?.patrimony ?? 0;

  console.log('=== Conferência abertura', OPENING_DATE, '===');
  console.log('Arquivo:', file);
  console.log('Alvo (IR/BTG):', targetPatrimony.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('');
  console.log('Soma planilha (qty × preço situação):');
  console.log('  Ativos longos:', sums.longValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('  Caixa:', sums.cash.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('  Prêmios shorts (referência IR):', sums.shortPremium.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const longPlusCash = sums.longValue + sums.cash;
  const patrimonySimple = longPlusCash - sums.shortPremium;
  console.log('  Long + caixa - ônus shorts:', patrimonySimple.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  if (longPlusCash > targetPatrimony) {
    const onusImplied = longPlusCash - targetPatrimony;
    console.log('');
    console.log('  (Longos > patrimônio alvo é esperado com opções vendidas.)');
    console.log('  Ônus de shorts + caixa que fecham o alvo (se shorts ainda vazias):');
    console.log('    ônus ≈ long + caixa - alvo =', onusImplied.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  }
  console.log('');
  console.log('Motor patrimônio (livro simulado, sem âncoras BTG):');
  console.log('  Patrimônio:', enginePatrimony.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('  Caixa:', (point?.cash ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('  Posições:', (point?.positionsValue ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('');
  const diffEngine = enginePatrimony - targetPatrimony;
  const diffSimple = sums.longValue + sums.cash - sums.shortPremium - targetPatrimony;
  console.log('Diferença vs alvo (motor):', diffEngine.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('Diferença vs alvo (long+caixa-shorts):', diffSimple.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

  if (sums.lines.length) {
    console.log('\nLinhas:');
    for (const l of sums.lines) {
      console.log(`  ${l.kind.padEnd(12)} ${l.ticker.padEnd(16)} ${l.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    }
  } else {
    console.log('\nNenhuma posição no JSON — preencha opening_positions e opening_short_options.');
  }

  console.log('\nReferência BTG âncora 31/12/2025:', (1_224_319).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
}

main();
