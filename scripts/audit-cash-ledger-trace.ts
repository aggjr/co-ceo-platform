/**
 * Rastreio de saldo de caixa (CAIXA-BTG) — detecta duplicatas e soma por origem.
 *
 *   npx ts-node scripts/audit-cash-ledger-trace.ts
 *   REMOTE_DB_PASSWORD=... REMOTE_DB_HOST=69.62.99.34 npx ts-node scripts/audit-cash-ledger-trace.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  cashBalanceFromLedger,
  settledCashBalanceFromLedger,
} from '../src/core/invest/cashInvestLedger';
import { isCashInvestTicker } from '../src/core/invest/cashInvestLedger';
import { buildCashInTransitSummary } from '../src/core/invest/cashInTransit';
import { applyCashInvestBalanceToItems } from '../src/core/invest/portfolioMapper';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const TODAY = new Date().toISOString().slice(0, 10);

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', TODAY);

  const cashEvents = events.filter((e) => isCashInvestTicker(String(e.asset_ticker)));
  const settled = settledCashBalanceFromLedger(events, TODAY);
  const gross = cashBalanceFromLedger(events, TODAY);
  const transit = buildCashInTransitSummary(events, TODAY);

  console.log('=== Rastreio caixa (org-holding) ===');
  console.log('Host:', host, '| Data:', TODAY);
  console.log('');
  console.log('Saldo bruto (soma CAIXA*):     ', brl(gross));
  console.log('Saldo liquidado (UI/extrato): ', brl(settled));
  console.log('Em trânsito líquido:          ', brl(transit.inTransitNet));
  console.log('Caixa + trânsito:             ', brl(transit.cashIncludingTransit));
  console.log('Lançamentos CAIXA*:          ', cashEvents.length);

  const byType = new Map<string, { count: number; sum: number }>();
  for (const e of cashEvents) {
    const t = String(e.transaction_type || '?');
    const cur = byType.get(t) || { count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += Number(e.total_net_value ?? 0);
    byType.set(t, cur);
  }
  console.log('\n--- Por transaction_type ---');
  for (const [t, v] of [...byType.entries()].sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum))) {
    console.log(`  ${t.padEnd(22)} ${String(v.count).padStart(5)} lanç.  soma=${brl(Math.round(v.sum * 100) / 100)}`);
  }

  const byRef = new Map<string, { count: number; sum: number; samples: string[] }>();
  for (const e of cashEvents) {
    const ref = String(e.broker_note_ref || '(sem ref)');
    const cur = byRef.get(ref) || { count: 0, sum: 0, samples: [] };
    cur.count += 1;
    cur.sum += Number(e.total_net_value ?? 0);
    if (cur.samples.length < 2) {
      cur.samples.push(
        `${e.transaction_date} ${e.transaction_type} ${brl(Number(e.total_net_value))} id=${String(e.id).slice(0, 8)}`
      );
    }
    byRef.set(ref, cur);
  }

  const dupRefs = [...byRef.entries()]
    .filter(([, v]) => v.count > 1 && Math.abs(v.sum) > 0.01)
    .sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum));

  console.log('\n--- broker_note_ref com múltiplos lançamentos (possível duplicata) ---');
  if (!dupRefs.length) console.log('  (nenhum ref com mais de 1 lançamento)');
  for (const [ref, v] of dupRefs.slice(0, 25)) {
    console.log(`  ${ref}: ${v.count}x soma=${brl(Math.round(v.sum * 100) / 100)}`);
    for (const s of v.samples) console.log(`      ${s}`);
  }

  const [fleSum] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) saldo, COUNT(*) c
     FROM financial_ledger_entries WHERE organization_id = ? AND deleted_at IS NULL`,
    [ORG]
  );
  const [pleCash] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT pi.identifier ticker, SUM(ple.total_value) soma, COUNT(*) c
     FROM patrimony_ledger_entries ple
     JOIN patrimony_items pi ON pi.id = ple.patrimony_item_id
     WHERE ple.organization_id = ? AND ple.deleted_at IS NULL
       AND pi.identifier LIKE 'CAIXA%'
     GROUP BY pi.identifier`,
    [ORG]
  );

  console.log('\n--- Fontes no banco ---');
  console.log('financial_ledger_entries (soma in-out):', brl(Number(fleSum[0]?.saldo ?? 0)), `(${fleSum[0]?.c} linhas)`);
  if (!pleCash.length) console.log('patrimony_ledger_entries CAIXA*: (nenhuma)');
  for (const r of pleCash) {
    console.log(`  PLE ${r.ticker}: ${brl(Number(r.soma))} (${r.c} lanç.)`);
  }

  const topIn = [...cashEvents]
    .filter((e) => Number(e.total_net_value) > 0)
    .sort((a, b) => Number(b.total_net_value) - Number(a.total_net_value))
    .slice(0, 15);
  const topOut = [...cashEvents]
    .filter((e) => Number(e.total_net_value) < 0)
    .sort((a, b) => Number(a.total_net_value) - Number(b.total_net_value))
    .slice(0, 15);

  console.log('\n--- Maiores entradas ---');
  for (const e of topIn) {
    console.log(
      `  ${e.transaction_date} ${brl(Number(e.total_net_value))} ${e.transaction_type} ref=${e.broker_note_ref || '—'} ${(e.notes || '').slice(0, 60)}`
    );
  }
  console.log('\n--- Maiores saídas ---');
  for (const e of topOut) {
    console.log(
      `  ${e.transaction_date} ${brl(Number(e.total_net_value))} ${e.transaction_type} ref=${e.broker_note_ref || '—'} ${(e.notes || '').slice(0, 60)}`
    );
  }

  const sumPred = (pred: (e: (typeof cashEvents)[0]) => boolean) =>
    cashEvents.filter(pred).reduce((s, e) => s + Number(e.total_net_value ?? 0), 0);

  console.log('\n--- Hipóteses de inflação ---');
  console.log('Sem refs BTG-EXTRACT:*:     ', brl(Math.round(sumPred((e) => !String(e.broker_note_ref || '').includes('BTG-EXTRACT')) * 100) / 100));
  console.log('Sem refs BTG-EXT-*:          ', brl(Math.round(sumPred((e) => !String(e.broker_note_ref || '').startsWith('BTG-EXT')) * 100) / 100));
  console.log('Metade do saldo atual:       ', brl(Math.round((settled / 2) * 100) / 100));

  const fp = new Map<string, number>();
  for (const e of cashEvents) {
    const key = [
      e.transaction_date,
      e.transaction_type,
      Number(e.total_net_value).toFixed(2),
      String(e.notes || '').slice(0, 55),
    ].join('|');
    fp.set(key, (fp.get(key) ?? 0) + 1);
  }
  let dupGroupSum = 0;
  for (const e of cashEvents) {
    const key = [
      e.transaction_date,
      e.transaction_type,
      Number(e.total_net_value).toFixed(2),
      String(e.notes || '').slice(0, 55),
    ].join('|');
    if ((fp.get(key) ?? 0) > 1) dupGroupSum += Number(e.total_net_value ?? 0);
  }
  console.log('Soma linhas em grupos duplicados:', brl(Math.round(dupGroupSum * 100) / 100));
  console.log('Total − grupos duplicados:      ', brl(Math.round((settled - dupGroupSum) * 100) / 100));

  const extractMay = cashEvents.filter((e) => {
    const d = String(e.transaction_date || '').slice(0, 10);
    return (
      String(e.broker_note_ref || '').includes('BTG-EXTRACT') &&
      d >= '2026-04-27' &&
      d <= '2026-05-26'
    );
  });
  console.log(`\nLançamentos BTG-EXTRACT (27/04–26/05): ${extractMay.length}, soma=${brl(Math.round(sumPred((e) => extractMay.includes(e)) * 100) / 100)}`);

  const extCash = cashEvents.filter((e) => String(e.broker_note_ref || '').startsWith('BTG-EXT-'));
  const extractCash = cashEvents.filter((e) =>
    String(e.broker_note_ref || '').includes('BTG-EXTRACT')
  );
  let extractTwinSum = 0;
  let extractTwinCount = 0;
  for (const ex of extractCash) {
    const amt = Number(ex.total_net_value ?? 0);
    if (Math.abs(amt) < 1000) continue;
    const twin = extCash.find(
      (t) =>
        t.transaction_date === ex.transaction_date &&
        Math.abs(Number(t.total_net_value ?? 0) - amt) < 0.02
    );
    if (twin) {
      extractTwinSum += amt;
      extractTwinCount += 1;
    }
  }
  console.log(
    `\nEXTRACT com gêmeo BTG-EXT (mesmo dia/valor, |>|1k): ${extractTwinCount} linhas, soma=${brl(Math.round(extractTwinSum * 100) / 100)}`
  );
  console.log('Saldo se remover só esses EXTRACT duplicados:', brl(Math.round((settled - extractTwinSum) * 100) / 100));

  const synthetic = applyCashInvestBalanceToItems([], settled);
  console.log('\n--- Linha sintética UI (applyCashInvestBalanceToItems) ---');
  console.log(JSON.stringify(synthetic[0] || null, null, 2));

  const outDir = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `audit-cash-trace-${TODAY}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        organizationId: ORG,
        settledCashBalance: settled,
        grossCashBalance: gross,
        cashInTransit: transit,
        cashEventCount: cashEvents.length,
        byType: Object.fromEntries(byType),
        duplicateRefs: dupRefs.map(([ref, v]) => ({ ref, ...v })),
        financialLedgerSum: Number(fleSum[0]?.saldo ?? 0),
        patrimonyCashPle: pleCash,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nRelatório JSON: ${outPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
