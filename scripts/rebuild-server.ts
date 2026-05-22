/**
 * Reconstrói todos os dados da plataforma no servidor, a partir dos arquivos e scripts base.
 * Uso: npx ts-node scripts/rebuild-server.ts
 */
import { execSync } from 'child_process';
import path from 'path';

const SCRIPTS = [
  'wipe-data.ts',
  '../src/database/seeds/002_holding_contract.ts',
  'import-opening-augusto.ts',
  'import-myprofit-augusto.ts',
  'import-btg-orders-augusto.ts',
  'import-btg-exercises-augusto.ts',
  'import-btg-extract-ledger.ts',
  'import-btg-brokerage-notes-ledger.ts',
  'import-may20-orders.ts',
  'daily-invest-close.ts'
];

async function main() {
  console.log('Iniciando reconstrução total do banco no servidor...\n');

  for (const script of SCRIPTS) {
    const fullPath = path.resolve(__dirname, script);
    console.log(`⏳ Executando: ${script}...`);
    try {
      execSync(`npx ts-node ${fullPath}`, { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      console.log(`✅ ${script} concluído com sucesso.\n`);
    } catch (error) {
      console.error(`❌ Erro ao executar ${script}. Interrompendo processo.`);
      process.exit(1);
    }
  }

  console.log('🎉 Reconstrução total concluída!');
}

main().catch(console.error);
