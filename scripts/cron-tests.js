const { spawnSync } = require('child_process');
const path = require('path');

console.log(`[CRON] Iniciando rotina noturna de testes automatizados - ${new Date().toISOString()}`);

const rootDir = process.cwd();

try {
  // 1. Roda os testes convencionais de regressão (garante que nada quebrou nas funcionalidades)
  console.log('[CRON] Executando testes unitários e de integração (npm run test:regression)...');
  const result = spawnSync('npm', ['run', 'test:regression'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });
  
  if (result.status !== 0) {
    console.error(`[CRON] ATENÇÃO: Regressão falhou com código ${result.status}. Verifique as quebras de código.`);
  } else {
    console.log('[CRON] Regressão convencional passou com sucesso.');
  }

  // 2. Dispara o Fuzzer Genético (que internamente avalia se deve rodar baseado nos 50 clientes)
  console.log('[CRON] Acionando pipeline de Fuzzing Genético e Teste de Carga...');
  const fuzzer = spawnSync('node', [path.join('scripts', 'genetic-fuzzer.js')], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });

  if (fuzzer.status !== 0) {
    console.error(`[CRON] Falha na execução do Fuzzer: ${fuzzer.status}`);
  }

  console.log(`[CRON] Rotina concluída com sucesso - ${new Date().toISOString()}`);

} catch (e) {
  console.error('[CRON] Falha catastrófica no runner:', e);
  process.exit(1);
}
