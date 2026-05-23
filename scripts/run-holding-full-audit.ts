/**
 * Pente fino completo holding: extrato + notas + livro (relatórios em local-import).
 *
 *   npx ts-node scripts/run-holding-full-audit.ts
 *   npx ts-node scripts/run-holding-full-audit.ts --skip-ledger
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const EXTRATO_PDF =
  process.env.BTG_EXTRATO_PDF ||
  path.join('G:', 'Meu Drive', '01 - Nova Estrutura', 'Extrato.pdf');
const BTG_BASE = path.join(ROOT, 'local-import', 'btg-sources');
const OUT = path.join(BTG_BASE, 'auditoria');

function run(cmd: string, label: string) {
  console.log(`\n${'='.repeat(60)}\n${label}\n${cmd}\n`);
  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  });
}

async function main() {
  const skipLedger = process.argv.includes('--skip-ledger');
  fs.mkdirSync(OUT, { recursive: true });

  if (fs.existsSync(EXTRATO_PDF)) {
    const dest = path.join(BTG_BASE, 'extrato', 'extrato.pdf');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(EXTRATO_PDF) !== path.resolve(dest)) {
      fs.copyFileSync(EXTRATO_PDF, dest);
      console.log('Extrato copiado para', dest);
    }
  }

  run('npx ts-node scripts/audit-btg-fees-full.ts', '1/7 Taxas extrato + notas (PDF)');
  run(
    `npx ts-node scripts/audit-extract-custody-fees.ts "${EXTRATO_PDF}"`,
    '2/7 Extrato × custódia × 3 preços'
  );
  run('npx ts-node scripts/survey-btg-option-economics.ts', '3/7 Economia venda opção / exercício');

  const extratoNorm = path.join(BTG_BASE, 'extrato', 'extrato-normalized.txt');
  const notasTxt = path.join('dados importação', 'documentos_txt_extraidos');
  if (fs.existsSync(extratoNorm) && fs.existsSync(notasTxt)) {
    run(
      `npx ts-node scripts/reconcile-btg-cash-vs-notes.ts "${extratoNorm}" "${notasTxt}"`,
      '4/7 LIQ BOLSA extrato vs líquido notas'
    );
  }

  if (!skipLedger) {
    run('npx ts-node scripts/reconcile-duplicate-operations.ts', '5/7 Duplicatas no livro');
    run('npx ts-node scripts/audit-holding-ledger-vs-sources.ts', '6/8 Livro × notas TXT');
    run('npx ts-node scripts/reconcile-holding.ts', '7/8 reconcileCustody');
    run('npx ts-node scripts/reconcile-btg-extract.ts', '8/8 Extrato vs livro (TEDs legado)');
  }

  run(
    'npx ts-node scripts/build-btg-brokerage-notes-from-txt.ts',
    'Regenerar notas-review.json (se TXTs existirem)'
  );

  const stamp = new Date().toISOString().slice(0, 10);
  const indexPath = path.join(OUT, `pente-fino-indice-${stamp}.md`);
  const md = `# Pente fino holding — ${stamp}

Relatórios gerados em \`local-import/btg-sources/auditoria/\`:

- \`auditoria-taxas-*.json\` — taxas notas + extrato
- \`auditoria-extrato-custodia-taxas-*.json\` — taxas com vínculo custódia / 3 preços
- \`levantamento-custos-opcoes-*.json\` — economia venda/exercício
- \`reconcile-duplicate-operations-*.json\` — duplicatas fingerprint/nota (se --skip-ledger ausente)

## Próximos passos (import)

1. \`remove-duplicate-opening-cash.ts\` — caixa 01/01 duplicado
2. \`build-btg-extract-import.ts\` + \`import-btg-extract-ledger.ts\`
3. \`build-btg-brokerage-notes-review.ts\` + \`import-btg-brokerage-notes-ledger.ts\`
4. \`reconcileCustody\` + validação três preços

`;
  fs.writeFileSync(indexPath, md, 'utf8');
  console.log(`\nÍndice: ${indexPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
