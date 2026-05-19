import fs from 'fs';
import path from 'path';
import { QualityRegressionService } from '../../../src/core/quality/QualityRegressionService';

jest.mock('../../../src/config/gateway', () => ({
  dataGateway: {
    readQuery: jest.fn().mockResolvedValue([
      {
        id: 'run-1',
        run_mode: 'full',
        status: 'passed',
        total_tests: 26,
        passed: 26,
        failed: 0,
        created_at: new Date().toISOString(),
      },
    ]),
  },
}));

const ROOT = path.join(__dirname, '../../..');
const REPORTS = path.join(ROOT, 'reports');

describe('QualityRegressionService', () => {
  const fixtureReport = {
    id: 'test-run-fixture',
    mode: 'full',
    status: 'passed',
    summary: { total: 26, passed: 26, failed: 0, skipped: 0 },
    policyCompliance: { activeUnits: 2, conformingUnits: 1, allActiveConform: false },
    units: [],
  };

  beforeAll(() => {
    fs.mkdirSync(REPORTS, { recursive: true });
    fs.writeFileSync(
      path.join(REPORTS, 'regression-latest.json'),
      JSON.stringify(fixtureReport)
    );
  });

  afterAll(() => {
    const p = path.join(REPORTS, 'regression-latest.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('carrega relatório, catálogo e política de cobertura', async () => {
    const dashboard = await QualityRegressionService.getDashboard();
    expect(dashboard.latest).toMatchObject({ mode: 'full', status: 'passed' });
    expect(dashboard.catalog).toMatchObject({ version: 1 });
    expect(
      (dashboard as { coveragePolicy?: { model: string } }).coveragePolicy
    ).toMatchObject({ model: 'risk-by-functionality' });
    expect(dashboard.reportFileExists).toBe(true);
  });

  it('carrega histórico via gateway readQuery', async () => {
    const dashboard = await QualityRegressionService.getDashboard();
    expect(dashboard.history.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.history[0]).toMatchObject({ run_mode: 'full' });
  });

  it('loadCatalog retorna unidades mapeadas', () => {
    const catalog = QualityRegressionService.loadCatalog() as {
      units: { id: string }[];
    };
    expect(catalog?.units?.length).toBeGreaterThanOrEqual(3);
    expect(catalog.units.some((u) => u.id === 'core.auth')).toBe(true);
  });
});
