/**
 * Executa suíte de regressão, gera relatório JSON e opcionalmente persiste no banco.
 * Uso: node scripts/run-regression.js [--mode=full|impact|unit] [--persist]
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const {
  evaluateAllUnits,
  summarizePolicyCompliance,
} = require('./lib/coverage-policy-eval');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'full';
const persist = args.includes('--persist');

function gitInfo() {
  try {
    return {
      branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(),
      commit: execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(),
    };
  } catch {
    return { branch: null, commit: null };
  }
}

function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'catalog.json'), 'utf8'));
}

function loadCoveragePolicy() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'coverage-policy.json'), 'utf8'));
}

function loadImpactPlan() {
  const p = path.join(ROOT, 'reports', 'impact-plan.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readCoverageSummary() {
  const p = path.join(ROOT, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const total = data.total || {};
  return {
    lines: total.lines?.pct ?? null,
    statements: total.statements?.pct ?? null,
    branches: total.branches?.pct ?? null,
    functions: total.functions?.pct ?? null,
  };
}

function buildUnitResults(catalog, jestResults) {
  const fileStatus = new Map();
  for (const suite of jestResults.testResults || []) {
    const absSuite = path.isAbsolute(suite.name)
      ? suite.name
      : path.join(ROOT, suite.name);
    const relSuite = path.relative(ROOT, absSuite).replace(/\\/g, '/');
    for (const test of suite.assertionResults || []) {
      const key = relSuite;
      if (!fileStatus.has(key)) {
        fileStatus.set(key, { passed: 0, failed: 0, total: 0 });
      }
      const stat = fileStatus.get(key);
      stat.total += 1;
      if (test.status === 'passed') stat.passed += 1;
      else if (test.status === 'failed') stat.failed += 1;
    }
  }

  return catalog.units.map((unit) => {
    let passed = 0;
    let failed = 0;
    let total = 0;
    for (const tf of unit.testFiles || []) {
      const stat = fileStatus.get(tf);
      if (!stat) continue;
      passed += stat.passed;
      failed += stat.failed;
      total += stat.total;
    }
    return {
      id: unit.id,
      label: unit.label,
      layer: unit.layer,
      testFiles: unit.testFiles || [],
      testsTotal: total,
      testsPassed: passed,
      testsFailed: failed,
      ok: failed === 0 && total > 0,
      uncovered: (unit.testFiles || []).length === 0,
    };
  });
}

function main() {
  execSync('node scripts/sync-test-catalog.js', { cwd: ROOT, stdio: 'inherit' });

  let jestArgs = [
    '--json',
    '--coverage',
    '--coverageReporters=json-summary',
    '--coverageReporters=json',
    '--coverageReporters=text',
  ];
  let impactPlan = null;
  let effectiveMode = mode;

  if (mode === 'impact') {
    try {
      execSync('node scripts/test-impact.js', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      /* git ausente — impacto vira full */
    }
    impactPlan = loadImpactPlan();
    effectiveMode = impactPlan?.mode || 'impact';
  } else if (mode === 'unit') {
    jestArgs.unshift('--selectProjects', 'unit-core');
  }

  const startedAt = new Date().toISOString();
  const jestOutPath = path.join(ROOT, 'reports', 'jest-results.json');
  fs.mkdirSync(path.dirname(jestOutPath), { recursive: true });

  const jestBin = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
  const testPathArgs =
    mode === 'impact' && impactPlan?.testFiles?.length ? impactPlan.testFiles : [];
  const jestArgv = [
    jestBin,
    ...jestArgs,
    '--outputFile',
    jestOutPath,
    ...(testPathArgs.length ? ['--', ...testPathArgs] : []),
  ];
  const jestRun = spawnSync(process.execPath, jestArgv, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const exitCode = jestRun.status ?? 1;

  const jestResults = fs.existsSync(jestOutPath)
    ? JSON.parse(fs.readFileSync(jestOutPath, 'utf8'))
    : { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, testResults: [] };

  const catalog = loadCatalog();
  const policyDoc = loadCoveragePolicy();
  const coverage = readCoverageSummary();
  const rawUnits = buildUnitResults(catalog, jestResults);
  const units = evaluateAllUnits(catalog, policyDoc, rawUnits, ROOT);
  const policyCompliance = summarizePolicyCompliance(units);
  const jestOk = exitCode === 0;
  const policyOk = policyCompliance.allActiveConform;

  const report = {
    id: crypto.randomUUID(),
    mode: effectiveMode,
    status: jestOk && policyOk ? 'passed' : 'failed',
    startedAt,
    finishedAt: new Date().toISOString(),
    git: gitInfo(),
    impact: impactPlan
      ? {
          matchedRules: impactPlan.matchedRules,
          selectedTests: impactPlan.testFiles?.length ?? jestResults.numTotalTests ?? 0,
          skippedTests: impactPlan.skippedCount ?? 0,
        }
      : null,
    summary: {
      total: jestResults.numTotalTests ?? 0,
      passed: jestResults.numPassedTests ?? 0,
      failed: jestResults.numFailedTests ?? 0,
      skipped: jestResults.numPendingTests ?? 0,
    },
    coverage,
    coveragePolicy: {
      model: policyDoc.model,
      summary: policyDoc.summary,
    },
    policyCompliance,
    catalog: {
      totalTestFiles: catalog.stats?.totalTestFiles ?? 0,
      unitsWithTests: catalog.stats?.unitsWithTests ?? 0,
      unitsWithoutTests: catalog.stats?.unitsWithoutTests ?? 0,
    },
    units,
    suites: (jestResults.testResults || []).map((s) => ({
      file: s.name,
      status: s.status,
      tests: s.assertionResults?.length ?? 0,
    })),
  };

  const latestPath = path.join(ROOT, 'reports', 'regression-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log('\n📊 Relatório:', latestPath);
  console.log(
    `   ${report.summary.passed}/${report.summary.total} testes OK | modo=${report.mode}`
  );
  console.log(
    `   Conformidade (unidades ativas): ${policyCompliance.conformingUnits}/${policyCompliance.activeUnits} | global linhas=${coverage?.lines ?? '—'}% (informativo)`
  );
  if (!policyOk) {
    for (const u of units.filter((x) => x.lifecycle === 'active' && !x.policyOk)) {
      console.log(`   ⚠ ${u.label}: ${(u.gaps || []).join('; ') || u.policyLabel}`);
    }
  }

  if (persist) {
    try {
      execSync(
        `node ./node_modules/ts-node/dist/bin.js scripts/persist-quality-run.ts "${report.id}"`,
        { cwd: ROOT, stdio: 'inherit' }
      );
    } catch (e) {
      console.warn('⚠️ Não foi possível persistir no banco:', e.message);
    }
  }

  process.exit(jestOk && policyOk ? 0 : 1);
}

main();
