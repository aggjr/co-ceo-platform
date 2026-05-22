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
const OPENING_BALANCE = 58758.79;
const CASH_ACCOUNT_EXTERNAL_ID = 'BTG';

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

  const entries = btgLinesToImportEntries(lines, OPENING_BALANCE);
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
  const saldoPrevisto = OPENING_BALANCE + totalMovido;
  const saldoDeclarado = extractDeclaredFinalBalance(rawLines);
  console.log(`\nSaldo abertura (01/01)  : R$ ${OPENING_BALANCE.toFixed(2)}`);
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

  console.log(`\n--apply: importando no servidor remoto (${process.env.REMOTE_DB_HOST})...`);
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD!,
    database: 'co_ceo_platform',
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

  // Anota broker_note_ref unico por linha para idempotencia (re-rodar nao duplica)
  const fingerprinted: LedgerImportLine[] = entries.map((e, i) => ({
    ...e,
    operation: e.operation as LedgerTransactionType,
    broker_note_ref: `BTG-EXTRACT:${firstDate}:${lastDate}:${i}:${e.operation}:${e.total_net_value}`,
  }));

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
