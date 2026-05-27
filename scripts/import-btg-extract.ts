/**
 * Importa extrato BTG (txt extraido do PDF) para o nucleo (financial_ledger_entries).
 *
 * Uso:
 *   npx ts-node scripts/import-btg-extract.ts data/btg/extrato.txt --dry
 *   npx ts-node scripts/import-btg-extract.ts data/btg/extrato.txt --apply
 *
 * Por padrao roda em DRY-RUN (so reporta o que faria). Use --apply para gravar
 * efetivamente no servidor remoto (lido de REMOTE_DB_* do .env).
 *
 * Saida:
 *   - Quantos lancamentos por tipo (capital_deposit, cash_yield, fee, ...)
 *   - Saldo de caixa previsto pelo nucleo no fim do periodo
 *   - Saldo real declarado pelo extrato BTG no fim do periodo (extraido do .txt)
 *   - Diff esperado = sum(LIQ BOLSA) skipadas = "buraco" do estoque
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../src/core/dal/types';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { btgLinesToImportEntries } from '../src/core/invest/BtgExtractLineParser';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';
import type { UserContext } from '../src/core/dal';
import type { LedgerImportLine, LedgerTransactionType } from '../src/core/invest/ledgerTypes';

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const DEFAULT_OPENING_BALANCE = 58758.79;
const CASH_ACCOUNT_EXTERNAL_ID = 'BTG';
const BR_NUMBER = /(\d{1,3}(?:\.\d{3})*,\d{2}|-\d{1,3}(?:\.\d{3})*,\d{2})/;

type Args = {
  file: string;
  apply: boolean;
};

function parseArgs(): Args {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: ts-node scripts/import-btg-extract.ts <arquivo.txt> [--dry|--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  return { file, apply };
}

function readAndNormalize(filePath: string): { normalized: string[]; raw: string[] } {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`Arquivo nao encontrado: ${abs}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(abs, 'utf-8');
  // Se ja vem normalizado (formato "Data Descricao ... Saldo Credito"), passa direto;
  // se vem cru do PDF (linhas quebradas), normaliza antes.
  const normalized = raw.includes('Movimentação - Conta Corrente')
    ? normalizeBtgExtractPdfText(raw)
    : raw;
  return { normalized: normalized.split(/\r?\n/), raw: raw.split(/\r?\n/) };
}

function parseBrMoney(raw: string): number {
  const neg = raw.trim().startsWith('-');
  const n = Number(raw.replace(/^-/, '').replace(/\./g, '').replace(',', '.'));
  return neg ? -n : n;
}

/** Saldo inicial declarado no extrato parcial (ex.: 26/04/2026). */
function extractOpeningBalance(lines: string[]): number | null {
  for (const line of lines) {
    if (!/Saldo\s+Inicial/i.test(line)) continue;
    const m = line.match(BR_NUMBER);
    if (m) return parseBrMoney(m[1]!);
  }
  return null;
}

function extractDeclaredFinalBalance(lines: string[]): number | null {
  const BR = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  // No PDF cru, o saldo final aparece colado: "6.397,36Saldo Final".
  // Procura linha contendo "Saldo Final" e pega o número que vier nela.
  for (const line of lines) {
    if (/Saldo\s*Final/i.test(line)) {
      const nums = [...line.matchAll(BR)].map((m) =>
        Number(m[0].replace(/\./g, '').replace(',', '.'))
      );
      if (nums.length) return nums[0]!;
    }
  }
  return null;
}

(async () => {
  const args = parseArgs();
  const { normalized: lines, raw: rawLines } = readAndNormalize(args.file);
  console.log(`Lido ${lines.length} linhas de ${args.file}`);

  const openingBalance = extractOpeningBalance(lines) ?? DEFAULT_OPENING_BALANCE;
  const entries = btgLinesToImportEntries(lines, openingBalance);
  console.log(
    `Saldo inicial do extrato: R$ ${openingBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  );
  console.log(`Parser classificou ${entries.length} lancamentos (LIQ BOLSA foi skipada).`);

  const byOp: Record<string, { count: number; total: number }> = {};
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const e of entries) {
    byOp[e.operation] = byOp[e.operation] || { count: 0, total: 0 };
    byOp[e.operation].count += 1;
    byOp[e.operation].total += e.total_net_value;
    if (!firstDate || e.date < firstDate) firstDate = e.date;
    if (!lastDate || e.date > lastDate) lastDate = e.date;
  }
  console.log(`Periodo: ${firstDate} -> ${lastDate}`);
  console.log('Resumo por operacao:');
  for (const op of Object.keys(byOp).sort()) {
    const r = byOp[op];
    console.log(`  ${op.padEnd(22)} count=${String(r.count).padStart(4)} total=R$ ${r.total.toFixed(2)}`);
  }

  const totalMovido = entries.reduce((s, e) => s + e.total_net_value, 0);
  const saldoPrevisto = openingBalance + totalMovido;
  const saldoDeclarado = extractDeclaredFinalBalance(rawLines);
  console.log(`\nSaldo abertura extrato  : R$ ${openingBalance.toFixed(2)}`);
  console.log(`Movimentos classificados: R$ ${totalMovido.toFixed(2)}`);
  console.log(`Saldo previsto pelo nucleo no fim do periodo: R$ ${saldoPrevisto.toFixed(2)}`);
  if (saldoDeclarado != null) {
    const diff = saldoPrevisto - saldoDeclarado;
    console.log(`Saldo declarado pelo extrato BTG           : R$ ${saldoDeclarado.toFixed(2)}`);
    console.log(`Diff (previsto - extrato)                  : R$ ${diff.toFixed(2)}`);
    console.log(`  (Esse diff = soma liquida das LIQ BOLSA skipadas = "buraco do estoque";`);
    console.log(`   vai a zero quando importarmos todas as notas de compra/venda/opcoes.)`);
  } else {
    console.log(`(Nao identifiquei "Saldo Final" no .txt para comparar.)`);
  }

  if (!args.apply) {
    console.log(`\n--dry: nada foi gravado. Use --apply para importar no servidor.`);
    return;
  }

  const dbHost = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  console.log(`\n--apply: importando em ${dbHost} (${process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform'})...`);
  const pool = mysql.createPool({
    host: dbHost,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    waitForConnections: true,
    connectionLimit: 4,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: ORG_ID,
    impersonatorId: null,
    scope: 'global',
  };

  const byDate = new Map<string, number>();
  const fingerprinted: LedgerImportLine[] = entries.map((e) => {
    const seq = (byDate.get(e.date) ?? 0) + 1;
    byDate.set(e.date, seq);
    return {
      ...e,
      operation: e.operation as LedgerTransactionType,
      broker_note_ref: `BTG-EXT-${e.date}#${String(seq).padStart(2, '0')}`,
    };
  });

  const result = await ledger.importEntriesOnly(ctx, fingerprinted, {
    sourceLabel: `Extrato BTG ${firstDate}->${lastDate}`,
  });
  console.log(`Importado: ${result.inserted} inseridos, ${result.skipped} pulados (ja existiam).`);

  void CASH_ACCOUNT_EXTERNAL_ID;
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
