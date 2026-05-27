/**
 * Zera INVEST da org-holding e reimporta na ordem canônica:
 * abertura 01/01 → notas BTG → extrato completo → batimento caixa.
 *
 *   npx ts-node scripts/rebuild-holding-from-zero.ts
 *   npx ts-node scripts/rebuild-holding-from-zero.ts --skip-notes
 *   npx ts-node scripts/rebuild-holding-from-zero.ts --dry-reset
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const TS = path.join(ROOT, 'node_modules/ts-node/dist/bin.js');
const EXTRATO_PDF =
  process.env.BTG_EXTRATO_PDF ||
  path.join('G:', 'Meu Drive', '01 - Nova Estrutura', 'Extrato.pdf');
const EXTRATO_NORM = path.join(
  'G:',
  'Meu Drive',
  '01 - Nova Estrutura',
  'Extrato-normalized.txt'
);

function run(label: string, cmd: string) {
  console.log(`\n${'='.repeat(60)}\n${label}\n${cmd}\n`);
  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    env: process.env,
  });
}

async function main() {
  const dryReset = process.argv.includes('--dry-reset');
  const skipNotes = process.argv.includes('--skip-notes');
  const skipExtract = process.argv.includes('--skip-extract');

  console.log('Org:', process.env.PORTFOLIO_ORG_ID || 'org-holding-001');
  console.log('Extrato PDF:', EXTRATO_PDF);

  run('Estado antes', `node scripts/inspect-invest-state.js`);

  if (dryReset) {
    run('Reset (dry-run)', 'node scripts/reset-invest-tables.js');
    console.log('\n--dry-reset: pare aqui. Rode sem --dry-reset para executar.');
    return;
  }

  run('Reset INVEST (hard delete)', 'node scripts/reset-invest-tables.js --confirm');
  run('Estado após reset', 'node scripts/inspect-invest-state.js');

  run('Abertura 01/01/2026', `node ${TS} scripts/import-opening-2026-01-01.ts`);

  if (!skipNotes) {
    run(
      'Notas BTG',
      `node ${TS} scripts/rebuild-holding-from-btg-notes.ts --skip-purge`
    );
  }

  if (!skipExtract) {
    if (!fs.existsSync(EXTRATO_PDF)) {
      console.error('PDF não encontrado:', EXTRATO_PDF);
      process.exit(1);
    }
    const staleTxt = EXTRATO_PDF.replace(/\.pdf$/i, '.txt');
    if (fs.existsSync(staleTxt)) {
      const pdfM = fs.statSync(EXTRATO_PDF).mtimeMs;
      const txtM = fs.statSync(staleTxt).mtimeMs;
      if (txtM < pdfM) {
        fs.unlinkSync(staleTxt);
        console.log('Removido Extrato.txt desatualizado.');
      }
    }
    run(
      'Converter extrato PDF',
      `node ${TS} scripts/convert-btg-extract-pdf.ts "${EXTRATO_PDF}"`
    );
    const norm = fs.existsSync(EXTRATO_NORM) ? EXTRATO_NORM : EXTRATO_PDF.replace(/\.pdf$/i, '-normalized.txt');
    run('Importar extrato', `node ${TS} scripts/import-btg-extract.ts "${norm}" --apply`);
    run('Batimento caixa dia a dia', `node ${TS} scripts/reconcile-cash-extract-daily.ts "${norm}"`);
  }

  console.log('\n=== Rebuild from zero concluído ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
