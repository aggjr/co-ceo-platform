/**
 * Pente fino: taxas/multas/emolumentos do extrato BTG com vínculo à custódia
 * (ações, opções, LFT/TD, BTC) vs livro razão INVEST.
 *
 *   npx ts-node scripts/audit-extract-custody-fees.ts
 *   npx ts-node scripts/audit-extract-custody-fees.ts "G:\\Meu Drive\\01 - Nova Estrutura\\Extrato.pdf"
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';
import {
  btgLinesToImportEntries,
  classifyBtgDescription,
  parseBtgMovementLine,
  type BtgExtractEntry,
} from '../src/core/invest/BtgExtractLineParser';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';

dotenv.config();

const nodeRequire = createRequire(__filename);
const { getDocument } = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs') as {
  getDocument: (opts: { data: Uint8Array; verbosity: number }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
      }>;
    }>;
  };
};

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const DEFAULT_PDF = path.join(process.cwd(), 'local-import/btg-sources/extrato/extrato.pdf');
const OUT_DIR = path.join(process.cwd(), 'local-import/btg-sources/auditoria');

const FEE_LINE =
  /IRRF|TAXA|EMOLUMENT|CUST[ÓO]DIA|CORRETAGEM|IOF|JUROS\s+SOBRE\s+SALDO|BTC\s*PRIO3|TESOURO|MULTA|REEMBOLSO/i;

type CustodyLink =
  | 'lft_td'
  | 'btc_prio3'
  | 'opcao_irrf_agregado'
  | 'rv_custodia_liq_bolsa'
  | 'custodia_mensal_caixa'
  | 'penalty_saldo_negativo'
  | 'emolumentos_btc_caixa'
  | 'outros_fee_caixa'
  | 'cost_adjustment_ok'
  | 'nao_taxa';

type FeeRow = {
  date: string;
  amount: number;
  signedAmount: number;
  description: string;
  custodyLink: CustodyLink;
  parserOperation: string;
  parserTicker: string;
  extractCategory?: number;
  eventSourceRef?: string;
  impactsThreePrices: 'sim' | 'parcial' | 'nao';
  issue?: string;
  ledgerMatch: 'found' | 'missing' | 'partial' | 'n/a';
  ledgerDetail?: string;
};

async function pdfToLines(filePath: string): Promise<string[]> {
  const buf = fs.readFileSync(filePath);
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line: string[] = [];
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (line.length) lines.push(line.join(' ').trim());
        line = [];
      }
      line.push(item.str);
      lastY = y;
    }
    if (line.length) lines.push(line.join(' ').trim());
  }
  return lines;
}

function brAmounts(desc: string): number[] {
  return [...desc.matchAll(/(-?[\d.]+,\d{2})/g)].map((m) =>
    Number(m[1]!.replace(/\./g, '').replace(',', '.'))
  );
}

function classifyCustodyLink(
  desc: string,
  entry: BtgExtractEntry | null
): { link: CustodyLink; impacts: FeeRow['impactsThreePrices']; issue?: string } {
  const u = desc.toUpperCase();
  if (entry?.operation === 'cost_adjustment' && entry.ticker !== 'CAIXA-BTG') {
    return { link: 'cost_adjustment_ok', impacts: 'sim' };
  }
  if (/IRRF\s+COBRADO\s+SOBRE\s+OPERACAO\s+DE\s+TESOURO|TAXA\s+DE\s+CUSTODIA\s+SOBRE\s+OPERACAO\s+DE\s+TESOURO|EMOLUMENTOS.+TESOURO/i.test(u)) {
    if (entry?.operation === 'cost_adjustment') {
      return { link: 'lft_td', impacts: 'sim' };
    }
    return {
      link: 'lft_td',
      impacts: 'nao',
      issue: 'IRRF/taxa TD no extrato mas parser não gerou cost_adjustment no LFT (falta TD no buffer do mês?)',
    };
  }
  if (/BTC\s*PRIO3|CORRETAGEM\s*BTC|IR\s*-\s*BTC/i.test(u)) {
    if (entry?.operation === 'cost_adjustment' && entry.ticker === 'PRIO3') {
      return { link: 'btc_prio3', impacts: 'sim' };
    }
    if (entry?.operation === 'fee' && /EMOLUMENT/i.test(u)) {
      return {
        link: 'emolumentos_btc_caixa',
        impacts: 'nao',
        issue: 'Emolumentos BTC lançados só em CAIXA; deveria ser cost_adjustment em PRIO3',
      };
    }
    return { link: 'btc_prio3', impacts: entry?.operation === 'cost_adjustment' ? 'sim' : 'parcial' };
  }
  if (/IRRF\s*-\s*LEI\s+11\.033.+OP[CÇ][AÃ]O/i.test(u)) {
    return {
      link: 'opcao_irrf_agregado',
      impacts: 'nao',
      issue:
        'IRRF opção agregado em CAIXA (BTG-IRRF-OPCAO-MENSAL); precisa vínculo com ticker da nota do pregão anterior',
    };
  }
  if (/LIQ\s+BOLSA.+TAXA\s+SOBRE\s+VALOR\s+EM\s+CUST|LIQ\s+BOLSA.+CUST[ÓO]DIA/i.test(u)) {
    return {
      link: 'rv_custodia_liq_bolsa',
      impacts: 'nao',
      issue:
        'Taxa de custódia RV liquidada via LIQ BOLSA; hoje vira fee em CAIXA — não entra nos 3 preços das ações/opções em custódia',
    };
  }
  if (/TAXA\s+DE\s+CUST|CUST[ÓO]DIA|REEMBOLSO\s+DE\s+CUST/i.test(u) && !/TESOURO|LFT/i.test(u)) {
    return {
      link: 'custodia_mensal_caixa',
      impacts: 'nao',
      issue: 'Custódia mensal genérica em CAIXA; ratear por ativo em custódia para PM estrito/gerencial',
    };
  }
  if (/JUROS\s+SOBRE\s+SALDO\s+NEGATIVO|IOF\s+SOBRE\s+SALDO/i.test(u)) {
    return {
      link: 'penalty_saldo_negativo',
      impacts: 'parcial',
      issue: 'Multa B3 em CAIXA; regra de negócio: ratear nas compras do dia anterior (nota)',
    };
  }
  if (entry?.operation === 'fee') {
    return { link: 'outros_fee_caixa', impacts: 'nao', issue: 'Taxa genérica só no financeiro (CAIXA)' };
  }
  return { link: 'nao_taxa', impacts: 'n/a' as FeeRow['impactsThreePrices'] };
}

function entryForLine(
  entries: BtgExtractEntry[],
  date: string,
  amount: number,
  desc: string
): BtgExtractEntry | null {
  const tol = 0.02;
  const u = desc.toUpperCase().slice(0, 40);
  const hits = entries.filter(
    (e) =>
      e.date === date &&
      Math.abs(Math.abs(e.total_net_value) - amount) < tol &&
      (e.notes || '').toUpperCase().includes(u.slice(0, 20))
  );
  if (hits.length === 1) return hits[0]!;
  const byDateAmt = entries.filter(
    (e) => e.date === date && Math.abs(Math.abs(e.total_net_value) - amount) < tol
  );
  return byDateAmt.length === 1 ? byDateAmt[0]! : byDateAmt[0] ?? null;
}

function ledgerMatches(
  events: LedgerEvent[],
  row: FeeRow
): { status: FeeRow['ledgerMatch']; detail?: string } {
  const tol = 0.02;
  const amt = row.amount;
  const candidates = events.filter((e) => {
    if (e.transaction_date !== row.date) return false;
    const v = Math.abs(Number(e.total_net_value) || Number(e.unit_price) || 0);
    if (Math.abs(v - amt) > tol) return false;
    const notes = (e.notes || '').toUpperCase();
    const frag = row.description.toUpperCase().slice(0, 24);
    return notes.includes(frag.slice(0, 12)) || frag.includes((e.asset_ticker || '').toUpperCase());
  });

  if (candidates.length === 0) {
    const byAmt = events.filter((e) => {
      if (e.transaction_date !== row.date) return false;
      const v = Math.abs(Number(e.total_net_value) || Number(e.unit_price) || 0);
      return Math.abs(v - amt) < tol;
    });
    if (byAmt.length === 0) return { status: 'missing' };
    if (byAmt.length === 1) {
      const e = byAmt[0]!;
      const ok =
        row.parserOperation === e.transaction_type &&
        (row.parserTicker === e.asset_ticker || row.custodyLink === 'cost_adjustment_ok');
      return {
        status: ok ? 'found' : 'partial',
        detail: `${e.transaction_type} ${e.asset_ticker} (notas diferentes)`,
      };
    }
    return { status: 'partial', detail: `${byAmt.length} candidatos no livro` };
  }
  const e = candidates[0]!;
  const impacts =
    e.transaction_type === 'cost_adjustment' ||
    e.impacts_managerial_price === true ||
    e.impacts_managerial_price === 1;
  return {
    status: 'found',
    detail: `${e.transaction_type} ${e.asset_ticker}${impacts ? ' (3P)' : ''}`,
  };
}

async function main() {
  const pdfPath = path.resolve(process.argv[2] || DEFAULT_PDF);
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF não encontrado:', pdfPath);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rawLines = await pdfToLines(pdfPath);
  const normalized = normalizeBtgExtractPdfText(rawLines.join('\n'));
  const normPath = path.join(path.dirname(pdfPath), 'extrato-normalized.txt');
  fs.writeFileSync(normPath, normalized, 'utf8');

  const lines = normalized.split(/\r?\n/).filter(Boolean);
  const importEntries = btgLinesToImportEntries(lines);

  const feeRows: FeeRow[] = [];
  let prev: number | null = null;

  for (const line of lines) {
    if (!FEE_LINE.test(line)) continue;
    const dm = line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/);
    if (!dm) continue;
    const iso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const desc = dm[4]!;
    if (/LIQ\s+BOLSA\s*\(OPERAC/i.test(desc) && !/TAXA|CUST[ÓO]DIA|IRRF|EMOLUMENT/i.test(desc)) {
      continue;
    }

    const parsed = parseBtgMovementLine(line, prev);
    if (parsed) prev = parsed.balance;

    const amounts = brAmounts(desc);
    const mov = amounts.length >= 2 ? amounts[amounts.length - 1]! : amounts[0] ?? 0;
    if (Math.abs(mov) < 0.001) continue;

    const map = classifyBtgDescription(desc);
    const entry = entryForLine(importEntries, iso, Math.abs(mov), desc);
    const { link, impacts, issue } = classifyCustodyLink(desc, entry);
    if (link === 'nao_taxa') continue;

    const row: FeeRow = {
      date: iso,
      amount: Math.abs(mov),
      signedAmount: parsed?.signedCash ?? mov,
      description: desc.slice(0, 160),
      custodyLink: link,
      parserOperation: entry?.operation ?? map.operation,
      parserTicker: entry?.ticker ?? map.ticker,
      extractCategory: entry?.extract_category,
      eventSourceRef: entry?.event_source_ref,
      impactsThreePrices: impacts,
      issue,
      ledgerMatch: 'n/a',
    };
    feeRows.push(row);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const events = await ledger.listLedgerEvents(ctx, '2026-01-01', '2026-06-30');
  const feeEvents = events.filter((e) =>
    ['fee', 'cost_adjustment', 'penalty_b3'].includes(String(e.transaction_type))
  );

  for (const row of feeRows) {
    const m = ledgerMatches(feeEvents, row);
    row.ledgerMatch = m.status;
    row.ledgerDetail = m.detail;
  }

  await pool.end();

  const missingInLedger = feeRows.filter((r) => r.ledgerMatch === 'missing');
  const noThreePrices = feeRows.filter((r) => r.impactsThreePrices === 'nao');
  const byLink = feeRows.reduce<Record<string, { count: number; total: number }>>((acc, r) => {
    const b = acc[r.custodyLink] ?? { count: 0, total: 0 };
    b.count += 1;
    b.total += r.amount;
    acc[r.custodyLink] = b;
    return acc;
  }, {});

  const stamp = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(OUT_DIR, `auditoria-extrato-custodia-taxas-${stamp}.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    pdf: pdfPath,
    orgId: ORG,
    summary: {
      feeLinesInExtract: feeRows.length,
      totalAmount: feeRows.reduce((s, r) => s + r.amount, 0),
      missingInLedger: missingInLedger.length,
      missingAmount: missingInLedger.reduce((s, r) => s + r.amount, 0),
      notImpactingThreePrices: noThreePrices.length,
      notImpactingAmount: noThreePrices.reduce((s, r) => s + r.amount, 0),
      byCustodyLink: byLink,
    },
    gapsForThreePrices: noThreePrices.map((r) => ({
      date: r.date,
      amount: r.amount,
      link: r.custodyLink,
      parser: `${r.parserOperation} @ ${r.parserTicker}`,
      issue: r.issue,
      ledger: r.ledgerMatch,
    })),
    missingInLedger: missingInLedger.map((r) => ({
      date: r.date,
      amount: r.amount,
      description: r.description,
      link: r.custodyLink,
    })),
    allRows: feeRows,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== Auditoria extrato × custódia × 3 preços ===\n');
  console.log(`PDF: ${pdfPath}`);
  console.log(`Linhas de taxa/despesa: ${feeRows.length}`);
  console.log(`Total extrato (taxas): R$ ${report.summary.totalAmount.toFixed(2)}`);
  console.log(`Sem impacto nos 3 preços: ${noThreePrices.length} linhas (R$ ${report.summary.notImpactingAmount.toFixed(2)})`);
  console.log(`Ausentes no livro: ${missingInLedger.length} (R$ ${report.summary.missingAmount.toFixed(2)})`);
  console.log('\nPor vínculo de custódia:');
  for (const [k, v] of Object.entries(byLink).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${k}: ${v.count} × R$ ${v.total.toFixed(2)}`);
  }
  console.log('\n--- Principais gaps (3 preços) ---');
  for (const g of report.gapsForThreePrices.slice(0, 25)) {
    console.log(`  ${g.date} R$ ${g.amount.toFixed(2)} [${g.link}] ${g.issue?.slice(0, 70) ?? ''}`);
  }
  if (report.gapsForThreePrices.length > 25) {
    console.log(`  ... +${report.gapsForThreePrices.length - 25}`);
  }
  console.log(`\nRelatório: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
