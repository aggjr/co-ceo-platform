/**
 * Sincroniza tests/catalog.json com arquivos *.test.ts existentes e contagens do Jest.
 * Unidades vêm do catálogo + tests/coverage-policy.json (metas proporcionais).
 */
const fs = require('fs');
const path = require('path');
const { resolveProportionalTargets } = require('./lib/test-proportionality');

const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'tests', 'catalog.json');
const POLICY_PATH = path.join(ROOT, 'tests', 'coverage-policy.json');

const UNIT_TEMPLATES = {
  'core.dal': {
    label: 'Gateway / DAL',
    layer: 'unit',
    tags: ['core', 'dal', 'security'],
    sourcePaths: ['src/core/dal/**'],
  },
  'core.auth': {
    label: 'Autenticação e autorização',
    layer: 'unit',
    tags: ['core', 'auth', 'security'],
    sourcePaths: ['src/core/auth/**', 'src/middlewares/**'],
  },
  'core.telemetry': {
    label: 'Telemetria',
    layer: 'unit',
    tags: ['core', 'telemetry'],
    sourcePaths: ['src/core/telemetry/**'],
  },
  'cockpit.api': {
    label: 'Cockpit API',
    layer: 'unit',
    tags: ['cockpit'],
    sourcePaths: [
      'src/controllers/CockpitController.ts',
      'src/core/auth/CockpitReadRepository.ts',
    ],
  },
  'core.quality': {
    label: 'Qualidade / regressão',
    layer: 'unit',
    tags: ['quality', 'regression'],
    sourcePaths: [
      'src/core/quality/**',
      'scripts/run-regression.js',
      'scripts/lib/coverage-policy-eval.js',
    ],
  },
  invest: {
    label: 'Módulo INVEST',
    layer: 'module',
    tags: ['invest'],
    sourcePaths: [
      'src/modules/invest/**',
      'src/controllers/InvestController.ts',
      'src/core/invest/**',
    ],
  },
  'invest.market-parity': {
    label: 'INVEST — paridade mercado (visão usuário)',
    layer: 'parity',
    tags: ['invest', 'market', 'parity', 'user-expectation'],
    sourcePaths: [
      'src/core/invest/B3QuoteProvider.ts',
      'src/core/invest/portfolioMapper.ts',
      'src/core/market/**',
      'src/core/invest/opcoesNetClient.ts',
      'src/core/invest/opcoesNetChainParser.ts',
    ],
  },
};

function walkTests(dir, prefix) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = `${prefix}/${name}`.replace(/\\/g, '/');
    if (fs.statSync(full).isDirectory()) {
      out.push(...walkTests(full, rel));
    } else if (name.endsWith('.test.ts')) {
      out.push(rel);
    }
  }
  return out;
}

function countCases(filePath) {
  const content = fs.readFileSync(path.join(ROOT, filePath), 'utf8');
  const itCount = (content.match(/\bit\s*\(/g) || []).length;
  const testCount = (content.match(/\btest\s*\(/g) || []).length;
  return itCount + testCount;
}

function assignUnit(testFile) {
  if (testFile.startsWith('tests/parity/')) return 'invest.market-parity';
  if (testFile.includes('/unit/quality/')) return 'core.quality';
  if (testFile.includes('Telemetry')) return 'core.telemetry';
  if (testFile.includes('/unit/market/')) return 'invest.market-parity';
  if (
    testFile.includes('/unit/invest/') ||
    testFile.includes('/unit/api/') ||
    testFile.includes('/unit/controllers/Invest') ||
    testFile.includes('/unit/jobs/') ||
    testFile.includes('/unit/modules/invest/')
  )
    return 'invest';
  if (testFile.includes('/unit/core/')) return 'core.dal';
  if (testFile.includes('/unit/auth/') || testFile.includes('/middlewares/'))
    return 'core.auth';
  return null;
}

function mergeUnitsFromPolicy(catalog) {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const byId = new Map(catalog.units.map((u) => [u.id, u]));

  for (const id of Object.keys(policy.units || {})) {
    const entry = policy.units[id];
    const tpl = UNIT_TEMPLATES[id] || {
      label: id,
      layer: 'unit',
      tags: [],
      sourcePaths: entry.sourcePaths || [],
    };

    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: tpl.label,
        layer: tpl.layer,
        tags: tpl.tags,
        sourcePaths: entry.sourcePaths || tpl.sourcePaths,
        testFiles: [],
        testCaseCount: 0,
      });
    } else {
      const u = byId.get(id);
      u.sourcePaths = entry.sourcePaths || u.sourcePaths || tpl.sourcePaths;
      u.label = u.label || tpl.label;
      u.layer = u.layer || tpl.layer;
      u.tags = u.tags?.length ? u.tags : tpl.tags;
    }

    const { targets, proportionality } = resolveProportionalTargets(
      byId.get(id),
      entry,
      ROOT
    );
    byId.get(id).policyTargets = {
      minTestCases: targets.minTestCases,
      minTestFiles: targets.minTestFiles,
      proportional: targets.proportional,
    };
    byId.get(id).proportionality = proportionality;
  }

  catalog.units = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  mergeUnitsFromPolicy(catalog);

  const allTests = [
    ...walkTests(path.join(ROOT, 'tests', 'unit'), 'tests/unit'),
    ...walkTests(path.join(ROOT, 'tests', 'middlewares'), 'tests/middlewares'),
    ...walkTests(path.join(ROOT, 'tests', 'parity'), 'tests/parity'),
  ];

  const byUnit = new Map(catalog.units.map((u) => [u.id, { ...u, testFiles: [] }]));

  const unassigned = [];
  for (const file of allTests) {
    const unitId = assignUnit(file);
    if (!unitId || !byUnit.has(unitId)) {
      unassigned.push(file);
      continue;
    }
    byUnit.get(unitId).testFiles.push(file);
  }

  for (const unit of byUnit.values()) {
    unit.testFiles = [...new Set(unit.testFiles)].sort();
    unit.testCaseCount = unit.testFiles.reduce((sum, f) => sum + countCases(f), 0);
  }

  catalog.units = [...byUnit.values()];
  catalog.updatedAt = new Date().toISOString().slice(0, 10);
  catalog.stats = {
    totalTestFiles: allTests.length,
    totalUnits: catalog.units.length,
    unitsWithTests: catalog.units.filter((u) => u.testFiles.length > 0).length,
    unitsWithoutTests: catalog.units.filter((u) => u.testFiles.length === 0).length,
    unassignedTestFiles: unassigned.length,
  };

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(
    `✅ Catálogo atualizado: ${catalog.stats.totalTestFiles} arquivos, ${catalog.stats.unitsWithTests} unidades cobertas.`
  );
  if (unassigned.length) {
    console.warn(`⚠️  ${unassigned.length} arquivo(s) sem unidade:`, unassigned.slice(0, 5).join(', '));
  }
}

main();
