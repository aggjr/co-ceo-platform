/**
 * Análise mensal jan–mai/2026: extrato + notas (arquivos locais) vs livro remoto.
 *
 *   npx ts-node scripts/analyze-btg-months-jan-mai.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { previewBtgBrokerageUpload, previewBtgExtractUpload } from '../src/core/invest/btgUploadImportService';
import type { BtgUploadFileInput } from '../src/core/invest/btgUploadImportService';
import { moneyMatch } from '../src/core/invest/btgExtractBatchReconcile';

dotenv.config();

const BASE = process.env.BTG_SOURCES_DIR || path.join('G:', 'Meu Drive', '01 - Nova Estrutura');
const NOTES_BASE = path.join(BASE, 'Notas Corretagem');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

const MONTHS: Array<{
  month: string;
  extractFile: string;
  notesDir: string;
  label: string;
}> = [
  {
    month: '2026-01',
    extractFile: 'Jan_2026.pdf',
    notesDir: '004176105_20260101_20260131',
    label: 'Jan/2026',
  },
  {
    month: '2026-02',
    extractFile: 'Fev_2026.pdf',
    notesDir: '004176105_20260201_20260228',
    label: 'Fev/2026',
  },
  {
    month: '2026-03',
    extractFile: 'Mar_2026.pdf',
    notesDir: '004176105_20260301_20260331',
    label: 'Mar/2026',
  },
  {
    month: '2026-04',
    extractFile: 'Abr_2026.pdf',
    notesDir: '004176105_20260401_20260430',
    label: 'Abr/2026',
  },
  {
    month: '2026-05',
    extractFile: 'Mai_2026.pdf',
    notesDir: '004176105_20260426_20260525',
    label: 'Mai/2026',
  },
];

function toB64(filePath: string): BtgUploadFileInput {
  const rel = path.basename(filePath);
  return {
    name: rel,
    contentBase64: fs.readFileSync(filePath).toString('base64'),
  };
}

function listPdfsRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPdfsRecursive(full));
    else if (/\.pdf$/i.test(ent.name)) out.push(full);
  }
  return out;
}

function brl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function analyzeFilesOnly() {
  const rows: Array<Record<string, string>> = [];
  let prevClosing: number | null = null;

  for (const spec of MONTHS) {
    const extractPath = path.join(BASE, spec.extractFile);
    const notesPath = path.join(NOTES_BASE, spec.notesDir);

    if (!fs.existsSync(extractPath)) {
      rows.push({
        Mês: spec.label,
        'Saldo ini. OK': '—',
        'Saldo fim OK': '—',
        'Carteira OK': '—',
        'Cadeia mês': '—',
        Detalhe: `Extrato ausente: ${spec.extractFile}`,
      });
      continue;
    }

    const notePaths = listPdfsRecursive(notesPath);
    const noteFiles: BtgUploadFileInput[] = notePaths.map((p) => ({
      name: path.relative(NOTES_BASE, p).replace(/\\/g, '/'),
      contentBase64: fs.readFileSync(p).toString('base64'),
    }));

    const extract = await previewBtgExtractUpload(toB64(extractPath));
    const notes = await previewBtgBrokerageUpload(noteFiles);

    const opening = extract.openingExtract ?? extract.preview?.openingBalance ?? null;
    const closing = extract.closingExtract ?? extract.preview?.lastExtractBalance ?? null;
    const chainOk = prevClosing == null || moneyMatch(opening, prevClosing);
    const chainLabel =
      prevClosing == null ? '—' : chainOk ? 'OK' : `Não (Δ ${brl((opening ?? 0) - prevClosing)})`;

    const saldoIniOk = extract.parseOk && chainOk;
    const saldoFimOk = extract.parseOk && closing != null;
    const carteiraOk =
      noteFiles.length > 0 && notes.filesOk === notes.filesTotal && notes.notesKept > 0;

    const internalOk =
      extract.preview &&
      extract.preview.firstDate?.startsWith(spec.month) &&
      extract.preview.lastDate?.startsWith(spec.month);

    rows.push({
      Mês: spec.label,
      'Saldo ini. OK': saldoIniOk ? 'OK' : 'Não',
      'Saldo fim OK': saldoFimOk ? 'OK' : 'Não',
      'Carteira OK': carteiraOk ? 'OK' : 'Não',
      'Cadeia mês': chainLabel,
      'Ini. extrato': brl(opening),
      'Fim extrato': brl(closing),
      Período: extract.preview
        ? `${extract.preview.firstDate} → ${extract.preview.lastDate}`
        : '—',
      Notas: `${notes.filesOk}/${noteFiles.length} PDF · ${notes.notesKept} notas · ${notes.ledgerLines} lanç.`,
      'Mês no extrato': internalOk ? 'OK' : 'Verificar',
      Detalhe: [
        !extract.parseOk ? extract.parseError : '',
        !carteiraOk ? notes.filesOk < notes.filesTotal ? 'PDF com erro de leitura' : 'sem notas' : '',
        !chainOk && prevClosing != null ? 'quebra cadeia entre extratos' : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Arquivos legíveis',
    });

    if (closing != null) prevClosing = closing;
  }

  return rows;
}

async function main() {
  const filesOnly = process.argv.includes('--files-only');
  let rows = await analyzeFilesOnly();

  if (!filesOnly) {
    const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
    const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
    if (!password) {
      console.warn('[analyze] Sem DB — apenas análise dos arquivos (--files-only implícito).\n');
    } else {
      try {
        const pool = mysql.createPool({
          host,
          user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
          password,
          database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
          charset: 'utf8mb4',
          connectTimeout: 15000,
        });
        const gateway = new CoCeoDataGateway(pool);
        const ledger = new LedgerImportService(gateway);
        const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

        rows = [];
        let prevClosing: number | null = null;
        for (const spec of MONTHS) {
          const extractPath = path.join(BASE, spec.extractFile);
          const notesPath = path.join(NOTES_BASE, spec.notesDir);
          if (!fs.existsSync(extractPath)) continue;

          const notePaths = listPdfsRecursive(notesPath);
          const noteFiles: BtgUploadFileInput[] = notePaths.map((p) => ({
            name: path.relative(NOTES_BASE, p).replace(/\\/g, '/'),
            contentBase64: fs.readFileSync(p).toString('base64'),
          }));

          const { previewBtgMonthImport } = await import('../src/core/invest/btgMonthImportService');
          const preview = await previewBtgMonthImport(
            ctx,
            ledger,
            spec.month,
            toB64(extractPath),
            noteFiles
          );

          const opening = preview.extract.openingExtract ?? null;
          const closing = preview.extract.closingExtract ?? null;
          const chainOk = prevClosing == null || moneyMatch(opening, prevClosing);

          rows.push({
            Mês: spec.label,
            'Saldo ini. OK':
              preview.extract.openingLedgerOk === true && chainOk ? 'OK' : 'Não',
            'Saldo fim OK': preview.extract.closingLedgerOk === true ? 'OK' : 'Não',
            'Carteira OK': preview.notesOk ? 'OK' : 'Não',
            'Cadeia mês': prevClosing == null ? '—' : chainOk ? 'OK' : 'Não',
            'Ini. extrato': brl(opening),
            'Fim extrato': brl(closing),
            'Livro fim': brl(preview.extract.closingLedgerBalance ?? null),
            'Δ fim': brl(preview.extract.closingLedgerDelta ?? null),
            Notas: `${preview.notes.notesKept} notas · ${preview.notes.ledgerLines} lanç.`,
            Resultado: preview.resultOk ? 'OK' : 'Não',
            Detalhe: preview.resultDetail,
          });
          if (closing != null) prevClosing = closing;
        }
        await pool.end();
      } catch (e) {
        console.warn('[analyze] Livro remoto indisponível — tabela só com arquivos.\n', e);
        rows = await analyzeFilesOnly();
      }
    }
  }

  console.log('\n=== Batimento mensal BTG jan–mai/2026 ===\n');
  console.log(`Extratos: ${BASE}`);
  console.log(`Notas: ${NOTES_BASE}\n`);
  console.table(rows);

  const problems = rows.filter(
    (r) => r['Saldo ini. OK'] === 'Não' || r['Saldo fim OK'] === 'Não' || r['Carteira OK'] === 'Não'
  );
  console.log(
    problems.length
      ? `\n${problems.length} mês(es) com atenção — ver coluna Detalhe.\n`
      : '\nNenhuma divergência óbvia nos arquivos (cadeia de extratos + leitura das notas).\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
