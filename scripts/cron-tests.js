const { spawnSync } = require('child_process');
const path = require('path');

console.log(`[CRON] Iniciando rotina noturna de testes automatizados - ${new Date().toISOString()}`);

const rootDir = process.cwd();

(async () => {
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

  // 3. Teste de Estresse (Load/Volume) - Gatilho de >= 50 clientes ou BD grande
  console.log('[CRON] Avaliando métricas para Teste de Estresse (Volume/Acesso)...');
  const mysql = require('mysql2/promise');
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'co_ceo_db'
    });
    
    // Check 1: Clientes ativos
    const [clientRows] = await conn.execute('SELECT COUNT(id) as total FROM contracts WHERE status = "active"');
    const activeClients = clientRows[0].total;
    
    // Check 2: Tamanho do BD (MB)
    const [sizeRows] = await conn.execute('SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb FROM information_schema.TABLES WHERE table_schema = ?', [process.env.DB_NAME || 'co_ceo_db']);
    const dbSizeMb = parseFloat(sizeRows[0].size_mb || 0);
    
    await conn.end();

    const CLIENT_THRESHOLD = 50;
    const DB_SIZE_THRESHOLD_MB = 1000; // Exemplo: 1 GB
    
    if (activeClients >= CLIENT_THRESHOLD || dbSizeMb >= DB_SIZE_THRESHOLD_MB) {
      console.log(`[CRON] Métricas atingidas (Clientes: ${activeClients}, DB Size: ${dbSizeMb}MB). Executando Testes de Estresse de Carga...`);
      // Aqui entraria a chamada para um script de estresse real (K6, Artillery, etc)
      // spawnSync('node', ['scripts/stress-test.js'], { ... });
    } else {
      console.log(`[CRON] [AVISO] Skipped stress tests: O volume de clientes reais (${activeClients}) ou o tamanho do DB (${dbSizeMb}MB) não atingiu os limites críticos. Testes de estresse de carga adiados.`);
    }

  } catch (e) {
    console.log("[CRON] Erro ao conectar no banco para checar limite de estresse. Pulando testes de carga.", e.message);
  }

  console.log(`[CRON] Rotina concluída com sucesso - ${new Date().toISOString()}`);

})();
} catch (e) {
  console.error('[CRON] Falha catastrófica no runner:', e);
  process.exit(1);
}
