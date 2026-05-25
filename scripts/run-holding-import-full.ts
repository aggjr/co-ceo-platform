/**
 * Importação completa holding (extrato + notas + snapshot + strikes) para análise na UI.
 * Uso: npx ts-node scripts/run-holding-import-full.ts
 */
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const TS = path.join(ROOT, 'node_modules/ts-node/dist/bin.js');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function run(label: string, script: string, args: string[] = []) {
  const cmd = [process.execPath, TS, path.join(__dirname, script), ...args]
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(' ');
  console.log(`\n========== ${label} ==========\n`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

async function main() {
  console.log('Org:', ORG);
  console.log('DB:', process.env.DB_NAME || process.env.REMOTE_DB_NAME || 'co_ceo_platform');
  console.log('Host:', process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1');

  run('Atualizar custody-snapshot.json (cotações)', 'patch-custody-snapshot-quotes.ts');

  const fullExtrato = path.join(ROOT, 'local-import/btg-sources/extrato/extrato-normalized.txt');
  run('Extrato completo → livro (remoto)', 'import-btg-extract.ts', [
    fullExtrato,
    '--apply',
  ]);

  const parcialExtrato = path.join(ROOT, 'local-import/btg-sources/extrato/Extrato-raw.txt');
  run('Extrato parcial 25/04–25/05 → livro', 'import-btg-extract.ts', [
    parcialExtrato,
    '--apply',
  ]);

  run('Build notas BTG (PDFs locais)', 'build-btg-notes-local-import.ts');
  const notasJson = path.join(ROOT, 'local-import/btg-sources/auditoria/notas-review-2026.json');
  run('Notas → livro', 'import-btg-brokerage-notes-ledger.ts', [notasJson]);

  run('Import snapshot custódia', 'import-broker-custody-snapshot.ts', [
    path.join(ROOT, 'local-import/btg-sources/custody-snapshot.json'),
  ]);
  run('Aplicar snapshot (cotações + âncora)', 'apply-broker-holding-snapshot.ts', ['2026-05-23']);
  run('Lançamentos opções pendentes', 'apply-broker-options-pending-ledger.ts', ['2026-05-23']);
  run('Strikes opções (capturas)', 'seed-options-market-capturas.ts');
  run('Patrimônio diário', 'record-daily-patrimony.ts', ['2026-05-23']);

  console.log('\n=== Importação concluída ===');
  console.log('Recarregue a UI (emulação org-holding-001) e confira Opções / Ações / Patrimônio.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
