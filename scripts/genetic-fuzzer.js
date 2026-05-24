const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/**
 * Fuzzer Genético Básico
 * Explora endpoints da API com payloads mutantes gerados via algoritmo genético.
 * REQUISITO: Somente rodar testes de stress quando houver mais de 50 clientes reais
 * REQUISITO: Retroalimentar dados (carregar falhas anteriores como sementes iniciais)
 */

const TARGET_URL = 'http://localhost:3000/api';

// Extrai dinamicamente os endpoints do arquivo de rotas para garantir que testes
// cubram todos os novos módulos desenvolvidos (ex: Cockpit, Invest e futuros).
function extractEndpointsFromRoutes() {
  const apiFile = fs.readFileSync(path.join(__dirname, '../src/routes/api.ts'), 'utf-8');
  const endpoints = [];
  
  // Regex para capturar router.get|post|put|delete('/caminho', ...)
  const routeRegex = /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = routeRegex.exec(apiFile)) !== null) {
    const method = match[1].toUpperCase();
    let routePath = match[2];
    
    // Substitui params de rota (ex: /:contractId) por valores dummy para o fuzzer não falhar no path
    routePath = routePath.replace(/:[a-zA-Z0-9_]+/g, '12345');
    
    endpoints.push({
      path: routePath,
      method: method,
      requiresAuth: apiFile.substring(match.index, match.index + 200).includes('AuthMiddleware.protect')
    });
  }
  
  return endpoints;
}

const TARGET_ENDPOINTS = extractEndpointsFromRoutes();

const {
  computeSeedPoolCap,
  selectHistoricalSeeds,
} = require('./lib/fuzzer-seed-pool');

const POPULATION_SIZE = 20;
const GENERATIONS = 5;

// Genes possíveis
const MUTATIONS = [
  "' OR 1=1 --",
  "null",
  "undefined",
  "99999999999999999999999999999",
  "{}",
  "[]",
  "<script>alert(1)</script>",
  "../../../../etc/passwd",
  "1; DROP TABLE users",
  "\\x00",
  "A".repeat(5000)
];

function generateRandomPayload() {
  const fields = ['email', 'password', 'date', 'id', 'organization_id', 'query', 'filter'];
  const payload = {};
  const numFields = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < numFields; i++) {
    const f = fields[Math.floor(Math.random() * fields.length)];
    payload[f] = MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)];
  }
  return payload;
}

function crossover(p1, p2) {
  const child = { ...p1 };
  for (const k in p2) {
    if (Math.random() > 0.5) child[k] = p2[k];
  }
  return child;
}

function mutate(payload) {
  const keys = Object.keys(payload);
  if (keys.length > 0 && Math.random() > 0.5) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    payload[k] = MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)];
  }
  return payload;
}

async function sendRequest(endpoint, payload) {
  return new Promise((resolve) => {
    let path = endpoint.path;
    let options = {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        // In a real scenario we would need a valid JWT token here for requiresAuth
        'Authorization': 'Bearer fake-jwt-token-for-fuzzing'
      }
    };

    let reqData = null;
    if (endpoint.method === 'GET') {
      const qs = new URLSearchParams(payload).toString();
      path += `?${qs}`;
    } else {
      reqData = JSON.stringify(payload);
      options.headers['Content-Length'] = Buffer.byteLength(reqData);
    }

    const req = http.request(TARGET_URL + path, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', (e) => {
      resolve({ statusCode: 0, error: e.message });
    });

    if (reqData) req.write(reqData);
    req.end();
  });
}

function evaluateFitness(res) {
  // 500s are high fitness (crashes)
  if (res.statusCode >= 500) return 100;
  // 0 is network error / timeout (also high fitness, could be ReDoS or crash)
  if (res.statusCode === 0) return 90;
  // 400 Bad request is expected (low fitness)
  if (res.statusCode >= 400 && res.statusCode < 500) return 10;
  // 200 OK with weird data might be unexpected but not a crash
  if (res.statusCode === 200) return 30;
  return 0;
}

async function runFuzzer() {
  console.log("Iniciando bateria de Fuzzing Genético Funcional...");

  // 1. Carregar Retroalimentação (Seeds do dia anterior) com PRIORIZAÇÃO
  let initialSeeds = [];
  try {
    if (fs.existsSync('fuzzing_report.json')) {
      let prev = JSON.parse(fs.readFileSync('fuzzing_report.json', 'utf-8'));
      if (Array.isArray(prev)) {
        // Remove 'Skipped' records and prioritize by fitness/status
        prev = prev.filter(r => r.payload && typeof r.fitness === 'number');
        const seedCap = computeSeedPoolCap(TARGET_ENDPOINTS.length);
        initialSeeds = selectHistoricalSeeds(prev, seedCap).slice(0, POPULATION_SIZE);
      }
    }
  } catch(e) {}
  if (initialSeeds.length > 0) {
    console.log(`[INFO] Carregadas ${initialSeeds.length} sementes de falhas prioritárias para retroalimentar a evolução.`);
  }

  const report = [];

  for (const endpoint of TARGET_ENDPOINTS) {
    console.log(`\nTestando endpoint: ${endpoint.method} ${endpoint.path}`);
    let population = [];
    
    // Injeta sementes retroalimentadas
    for(let seed of initialSeeds) {
      population.push(seed);
    }
    // Completa com novos aleatórios
    while(population.length < POPULATION_SIZE) {
      population.push(generateRandomPayload());
    }
    
    for (let gen = 0; gen < GENERATIONS; gen++) {
      console.log(`  Geração ${gen + 1}/${GENERATIONS}`);
      
      const results = [];
      for (const p of population) {
        const res = await sendRequest(endpoint, p);
        const fitness = evaluateFitness(res);
        results.push({ payload: p, fitness, res });
        
        if (fitness >= 90) {
          report.push({
            endpoint: endpoint.path,
            method: endpoint.method,
            payload: p,
            statusCode: res.statusCode,
            response: res.body ? res.body.substring(0, 100) : res.error
          });
        }
      }
      
      results.sort((a, b) => b.fitness - a.fitness);
      
      // Seleciona os melhores
      const best = results.slice(0, 5).map(r => r.payload);
      
      // Reprodução
      const nextGen = [...best];
      while (nextGen.length < POPULATION_SIZE) {
        const p1 = best[Math.floor(Math.random() * best.length)];
        const p2 = best[Math.floor(Math.random() * best.length)];
        let child = crossover(p1, p2);
        if (Math.random() > 0.3) child = mutate(child);
        nextGen.push(child);
      }
      
      population = nextGen;
    }
  }

  fs.writeFileSync('fuzzing_report.json', JSON.stringify(report, null, 2));
  console.log(`\nFuzzing concluído. Encontrados ${report.length} potenciais vulnerabilidades.`);
}

runFuzzer().catch(console.error);
