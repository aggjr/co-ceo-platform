import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  evaluateAllUnits,
  summarizePolicyCompliance,
} = require('../../../scripts/lib/coverage-policy-eval');

describe('CoveragePolicyEval', () => {
  const catalog = {
    units: [
      {
        id: 'core.dal',
        label: 'DAL',
        layer: 'unit',
        sourcePaths: ['src/core/dal/**'],
        testFiles: ['tests/unit/core/TableRegistry.test.ts'],
        testCaseCount: 3,
      },
      {
        id: 'invest',
        label: 'INVEST',
        layer: 'module',
        sourcePaths: ['src/modules/invest/**'],
        testFiles: [],
        testCaseCount: 0,
      },
    ],
  };

  const policyDoc = {
    units: {
      'core.dal': {
        lifecycle: 'active',
        criticality: 'P0',
        functionalities: [{ id: 'audit', label: 'Audit' }],
        targets: { lineCoveragePct: 50, minTestCases: 2, minTestFiles: 1 },
      },
      invest: {
        lifecycle: 'planned',
        criticality: 'P1',
        functionalities: [],
        targets: { lineCoveragePct: 75, minTestCases: 8, minTestFiles: 3 },
      },
    },
  };

  it('marca unidade planned como conforme sem exigir testes', () => {
    const units = evaluateAllUnits(
      catalog,
      policyDoc,
      [{ id: 'invest', testsTotal: 0, testsPassed: 0, testsFailed: 0 }],
      process.cwd()
    );
    const invest = units.find((u: { id: string }) => u.id === 'invest');
    expect(invest?.policyStatus).toBe('planned');
    expect(invest?.policyOk).toBe(true);
  });

  it('detecta gap quando casos abaixo da meta', () => {
    const sparseCatalog = {
      units: [
        {
          ...catalog.units[0],
          testCaseCount: 1,
        },
        catalog.units[1],
      ],
    };
    const units = evaluateAllUnits(
      sparseCatalog,
      policyDoc,
      [{ id: 'core.dal', testsTotal: 1, testsPassed: 1, testsFailed: 0 }],
      process.cwd()
    );
    const dal = units.find((u: { id: string }) => u.id === 'core.dal');
    expect(dal?.gaps.some((g: string) => g.includes('Casos de teste'))).toBe(true);
    expect(dal?.policyOk).toBe(false);
  });

  it('resume conformidade de unidades ativas', () => {
    const units = evaluateAllUnits(catalog, policyDoc, [], process.cwd());
    const summary = summarizePolicyCompliance(units);
    expect(summary.activeUnits).toBe(1);
    expect(summary.plannedUnits).toBe(1);
  });
});

describe('matchGlob (via coverage eval paths)', () => {
  it('catalog e policy existem no repositório', () => {
    const root = path.join(__dirname, '../../..');
    expect(
      require('fs').existsSync(path.join(root, 'tests/coverage-policy.json'))
    ).toBe(true);
    expect(require('fs').existsSync(path.join(root, 'tests/impact-map.json'))).toBe(true);
  });
});
