/**
 * Reimporta notas BTG com parser corrigido, preservando saldo inicial 01/01/2026.
 *
 * 1. purge-holding-keep-opening (mantém OPENING:2026-01-01)
 * 2. build-btg-brokerage-notes-review (PDFs → JSON)
 * 3. import-btg-brokerage-notes-ledger (JSON → núcleo patrimonial)
 *
 * Uso:
 *   npx ts-node scripts/rebuild-holding-from-btg-notes.ts
 *   npx ts-node scripts/rebuild-holding-from-btg-notes.ts --skip-purge
 *   BTG_NOTES_DIR="g:\Meu Drive\...\Notas Corretagem" npx ts-node scripts/rebuild-holding-from-btg-notes.ts
 */
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const TS_NODE = path.join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
const NOTES_DIR =
  process.env.BTG_NOTES_DIR ||
  'g:\\Meu Drive\\01 - Nova Estrutura\\Notas Corretagem';
const OUT_JSON = path.join(ROOT, 'local-import', 'btg-sources', 'auditoria', 'notas-review-2026.json');

const skipPurge = process.argv.includes('--skip-purge');
const skipBuild = process.argv.includes('--skip-build');
const skipImport = process.argv.includes('--skip-import');

function run(label: string, scriptRel: string, extraArgs: string[] = []) {
  const script = path.join(__dirname, scriptRel);
  const cmd = [
    process.execPath,
    TS_NODE,
    script,
    ...extraArgs,
  ]
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(' ');
  console.log(`\n=== ${label} ===\n> ${cmd}\n`);
  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      BTG_NOTES_OUT_JSON: OUT_JSON,
    },
  });
}

async function main() {
  console.log('Org:', process.env.PORTFOLIO_ORG_ID || 'org-holding-001');
  console.log('DB:', process.env.DB_NAME || 'co_ceo_platform');
  console.log('Notas:', NOTES_DIR);
  console.log('JSON:', OUT_JSON);
  console.log('Abertura preservada: OPENING:2026-01-01 (saldo inicial)\n');

  if (!skipPurge) {
    run('Purge (mantém abertura)', 'purge-holding-keep-opening.ts');
  }

  if (!skipBuild) {
    run('Build JSON das notas', 'build-btg-brokerage-notes-review.ts', [NOTES_DIR]);
  }

  if (!skipImport) {
    run('Import livro', 'import-btg-brokerage-notes-ledger.ts', [OUT_JSON]);
  }

  console.log('\nConcluído. Opcional: npm run record:patrimony:daily');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
