/**
 * Importa extrato BTG (monthly_statements) no livro com idempotência por broker_note_ref.
 * Garante saldo CAIXA-BTG = último saldo do extrato após import.
 *
 * Uso: npx ts-node scripts/import-btg-extract-ledger.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerImportLine, LedgerImportPayload } from '../src/core/invest/ledgerTypes';
import { settledCashBalanceFromLedger } from '../src/core/invest/cashInvestLedger';
import { lastExtractCashPoint, loadBtgExtractCashDailySeries } from '../src/core/invest/btgExtractCashSeries';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const EXTRACT_JSON = path.join(__dirname, '..', 'data', 'invest', 'btg-augusto-h1-2026.json');
const OPENING_CASH_REF = 'BTG-EXTRATO-OPENING-2026-01-01';
const CASH_RECON_REF = 'BTG-EXTRATO-CASH-RECON-2026-05-21';

function withExtractRefs(entries: LedgerImportLine[]): LedgerImportLine[] {
  const byDate = new Map<string, number>();
  return entries.map((e) => {
    const seq = (byDate.get(e.date) ?? 0) + 1;
    byDate.set(e.date, seq);
    return {
      ...e,
      broker_note_ref: `BTG-EXT-${e.date}#${String(seq).padStart(2, '0')}`,
      impacts_managerial_price: e.impacts_managerial_price ?? false,
    };
  });
}

async function main() {
  if (!fs.existsSync(EXTRACT_JSON)) {
    console.error('JSON não encontrado. Rode: npx ts-node scripts/build-btg-extract-import.ts');
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(EXTRACT_JSON, 'utf8')) as LedgerImportPayload;
  const rawEntries =
    payload.monthly_statements?.flatMap((st) => st.entries || []) ?? payload.entries ?? [];
  const entries = withExtractRefs(rawEntries);

  const cashOpening = Number(
    (payload as { meta?: { cash_opening_2026_01_01?: number } }).meta?.cash_opening_2026_01_01 ??
      58758.79
  );

  const { series } = loadBtgExtractCashDailySeries();
  const lastExtract = lastExtractCashPoint(series);
  const targetCash = lastExtract?.balance ?? null;
  const reconDate = lastExtract?.date ?? '2026-05-21';

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  const refRows = await gateway.readQuery(ctx, 'invest_ledger_note_refs', [ORG_ID]);
  const existingRefs = new Set(
    refRows.map((r) => String(r.broker_note_ref || '').trim()).filter(Boolean)
  );

  const preamble: LedgerImportLine[] = [];
  if (!existingRefs.has(OPENING_CASH_REF)) {
    preamble.push({
      date: '2026-01-01',
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      operation: 'capital_deposit',
      quantity: 0,
      unit_price: 0,
      total_net_value: cashOpening,
      broker_note_ref: OPENING_CASH_REF,
      notes: 'Saldo inicial conta corrente BTG (extrato 01/01/2026)',
      impacts_managerial_price: false,
    });
  }

  console.log(`Extrato → org ${ORG_ID}: ${entries.length} lançamentos (+${preamble.length} abertura caixa)`);
  if (targetCash != null) {
    console.log(`Alvo saldo extrato ${reconDate}: R$ ${targetCash.toLocaleString('pt-BR')}`);
  }

  const importResult = await ledger.importEntriesOnly(ctx, [...preamble, ...entries], {
    sourceLabel: 'Extrato BTG conta corrente (PDF 21/05/2026)',
  });
  console.log('Import:', JSON.stringify(importResult, null, 2));

  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  let ledgerCash = settledCashBalanceFromLedger(events, reconDate);

  if (targetCash != null && Math.abs(targetCash - ledgerCash) > 0.02) {
    const delta = Math.round((targetCash - ledgerCash) * 100) / 100;
    if (!existingRefs.has(CASH_RECON_REF)) {
      const reconResult = await ledger.importEntriesOnly(
        ctx,
        [
          {
            date: reconDate,
            ticker: 'CAIXA-BTG',
            asset_type: 'cash',
            operation: 'cash_yield',
            quantity: 0,
            unit_price: 0,
            total_net_value: delta,
            broker_note_ref: CASH_RECON_REF,
            notes: `Ajuste saldo conta vs extrato BTG (${ledgerCash.toFixed(2)} → ${targetCash.toFixed(2)}); Tesouro/LIQ agregado fora do fluxo CAIXA no livro`,
            impacts_managerial_price: false,
          },
        ],
        { sourceLabel: 'Reconciliação extrato BTG' }
      );
      console.log('Recon caixa:', JSON.stringify(reconResult, null, 2));
      const events2 = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
      ledgerCash = settledCashBalanceFromLedger(events2, reconDate);
    } else {
      console.warn(
        `Saldo livro ${ledgerCash.toFixed(2)} ≠ extrato ${targetCash.toFixed(2)} (ref ${CASH_RECON_REF} já existe)`
      );
    }
  }

  console.log(`\nSaldo CAIXA-BTG em ${reconDate}: R$ ${ledgerCash.toLocaleString('pt-BR')}`);
  if (targetCash != null) {
    const ok = Math.abs(ledgerCash - targetCash) < 0.02;
    console.log(ok ? 'OK — bate com extrato' : 'ATENÇÃO — divergência com extrato');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
