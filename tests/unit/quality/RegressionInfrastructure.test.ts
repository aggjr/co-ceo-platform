/**
 * Valida artefatos da infraestrutura de regressão (catálogo, impacto, relatório).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../..');

describe('Regression infrastructure artifacts', () => {
  it('catalog.json lista unidades com sourcePaths e testFiles', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'tests/catalog.json'), 'utf8')
    );
    expect(catalog.units.length).toBeGreaterThanOrEqual(5);
    const dal = catalog.units.find((u: { id: string }) => u.id === 'core.dal');
    expect(dal?.sourcePaths).toContain('src/core/dal/**');
    expect(dal?.testFiles?.length).toBeGreaterThan(0);
  });

  it('coverage-policy.json não usa meta global 80%', () => {
    const policy = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'tests/coverage-policy.json'), 'utf8')
    );
    expect(policy.summary).toMatch(/não existe meta global/i);
    expect(policy.units['core.dal']?.targets?.lineCoveragePct).toBe(85);
    expect(policy.units.invest?.lifecycle).toBe('planned');
  });

  it('impact-map.json define gatilhos de reteste completo', () => {
    const impact = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'tests/impact-map.json'), 'utf8')
    );
    expect(impact.fullRetestTriggers).toContain('src/core/dal/**');
    expect(impact.paths['src/core/auth/**']?.testPatterns?.length).toBeGreaterThan(0);
  });

  it('relatório regression-latest.json existe após npm run test:regression', () => {
    const reportPath = path.join(ROOT, 'reports/regression-latest.json');
    if (!fs.existsSync(reportPath)) {
      console.warn('Execute npm run test:regression para gerar o relatório.');
      return;
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.summary).toBeDefined();
    expect(report.policyCompliance).toBeDefined();
    expect(Array.isArray(report.units)).toBe(true);
  });
});
