/**
 * Avalia conformidade por unidade (risco × funcionalidade), não % global fixo.
 */
const fs = require('fs');
const path = require('path');

function matchGlob(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  const glob = pattern.replace(/\\/g, '/');

  if (glob.endsWith('/**')) {
    const prefix = glob.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }

  const re = new RegExp(
    `^${glob.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`
  );
  return re.test(normalized);
}

function computeUnitLineCoverage(sourcePaths, lineTotalsByRel) {
  if (!lineTotalsByRel) return null;

  let totalLines = 0;
  let coveredLines = 0;

  for (const [rel, lines] of lineTotalsByRel.entries()) {
    if (!sourcePaths.some((g) => matchGlob(rel, g))) continue;
    if (!lines) continue;
    totalLines += lines.total || 0;
    coveredLines += lines.covered || 0;
  }

  if (totalLines === 0) return null;
  return Math.round((coveredLines / totalLines) * 1000) / 10;
}

function loadLineTotalsByRel(rootDir) {
  const p = path.join(rootDir, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const map = new Map();
  for (const [fileKey, stats] of Object.entries(data)) {
    if (fileKey === 'total') continue;
    const rel = path.relative(rootDir, fileKey).replace(/\\/g, '/');
    map.set(rel, stats?.lines || null);
  }
  return map;
}

function evaluateUnitPolicy(unit, policyEntry, testStats) {
  const policy = policyEntry || {};
  const lifecycle = policy.lifecycle || 'active';
  const targets = policy.targets || {};
  const testFiles = unit.testFiles || [];
  const testCaseCount = unit.testCaseCount ?? testStats?.total ?? 0;

  const base = {
    criticality: policy.criticality || '—',
    lifecycle,
    rationale: policy.rationale || '',
    functionalities: policy.functionalities || [],
    targets: {
      lineCoveragePct: targets.lineCoveragePct ?? null,
      minTestCases: targets.minTestCases ?? 0,
      minTestFiles: targets.minTestFiles ?? 0,
    },
    actual: {
      lineCoveragePct: testStats?.lineCoveragePct ?? null,
      testCases: testCaseCount,
      testFiles: testFiles.length,
      testsPassed: testStats?.passed ?? 0,
      testsFailed: testStats?.failed ?? 0,
      testsTotal: testStats?.total ?? 0,
    },
    gaps: [],
  };

  if (lifecycle === 'planned') {
    return {
      ...base,
      policyStatus: 'planned',
      policyOk: true,
      policyLabel: 'Planejado (módulo não exige gate ainda)',
    };
  }

  if (targets.minTestFiles && testFiles.length < targets.minTestFiles) {
    base.gaps.push(`Arquivos de teste: ${testFiles.length}/${targets.minTestFiles}`);
  }
  if (targets.minTestCases && testCaseCount < targets.minTestCases) {
    base.gaps.push(`Casos de teste: ${testCaseCount}/${targets.minTestCases}`);
  }
  if (testStats?.failed > 0) {
    base.gaps.push(`${testStats.failed} caso(s) falhando`);
  }
  if (
    targets.lineCoveragePct != null &&
    testStats?.lineCoveragePct != null &&
    testStats.lineCoveragePct < targets.lineCoveragePct
  ) {
    base.gaps.push(
      `Cobertura linhas: ${testStats.lineCoveragePct}% < meta ${targets.lineCoveragePct}%`
    );
  }
  const policyOk = base.gaps.length === 0 && (testStats?.total ?? 0) > 0;
  return {
    ...base,
    policyStatus: policyOk ? 'ok' : testFiles.length === 0 ? 'no_tests' : 'below_target',
    policyOk,
    policyLabel: policyOk
      ? 'Em conformidade'
      : testFiles.length === 0
        ? 'Sem testes para esta unidade'
        : 'Abaixo da meta da unidade',
  };
}

function evaluateAllUnits(catalog, policyDoc, jestUnitResults, rootDir) {
  const lineTotalsByRel = loadLineTotalsByRel(rootDir);
  const policies = policyDoc.units || {};

  return catalog.units.map((unit) => {
    const testStats = jestUnitResults.find((u) => u.id === unit.id) || {};
    const lineCoveragePct = computeUnitLineCoverage(unit.sourcePaths || [], lineTotalsByRel);

    const mergedStats = {
      passed: testStats.testsPassed ?? 0,
      failed: testStats.testsFailed ?? 0,
      total: testStats.testsTotal ?? 0,
      testCaseCount: unit.testCaseCount ?? testStats.testsTotal ?? 0,
      lineCoveragePct,
    };

    const policyEval = evaluateUnitPolicy(
      unit,
      policies[unit.id],
      mergedStats
    );

    return {
      id: unit.id,
      label: unit.label,
      layer: unit.layer,
      testFiles: unit.testFiles || [],
      testCaseCount: mergedStats.testCaseCount,
      testsTotal: mergedStats.total,
      testsPassed: mergedStats.passed,
      testsFailed: mergedStats.failed,
      ok: mergedStats.failed === 0 && mergedStats.total > 0,
      uncovered: (unit.testFiles || []).length === 0,
      ...policyEval,
    };
  });
}

function summarizePolicyCompliance(units) {
  const active = units.filter((u) => u.lifecycle === 'active');
  const ok = active.filter((u) => u.policyOk);
  const planned = units.filter((u) => u.lifecycle === 'planned');
  return {
    activeUnits: active.length,
    conformingUnits: ok.length,
    plannedUnits: planned.length,
    allActiveConform: active.length > 0 && ok.length === active.length,
  };
}

module.exports = {
  evaluateAllUnits,
  summarizePolicyCompliance,
  computeUnitLineCoverage,
};
