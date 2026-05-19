import fs from 'fs';
import path from 'path';
import { dataGateway } from '../../config/gateway';
import { authBootstrapContext } from '../auth/authBootstrapContext';

export interface RegressionDashboard {
  latest: Record<string, unknown> | null;
  catalog: Record<string, unknown> | null;
  history: Record<string, unknown>[];
  reportFileExists: boolean;
}

const ROOT = process.cwd();
const LATEST_REPORT = path.join(ROOT, 'reports', 'regression-latest.json');
const CATALOG_PATH = path.join(ROOT, 'tests', 'catalog.json');
const IMPACT_PLAN = path.join(ROOT, 'reports', 'impact-plan.json');

export class QualityRegressionService {
  static loadLatestReport(): Record<string, unknown> | null {
    if (!fs.existsSync(LATEST_REPORT)) return null;
    return JSON.parse(fs.readFileSync(LATEST_REPORT, 'utf8')) as Record<string, unknown>;
  }

  static loadCatalog(): Record<string, unknown> | null {
    if (!fs.existsSync(CATALOG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as Record<string, unknown>;
  }

  static loadCoveragePolicy(): Record<string, unknown> | null {
    const p = path.join(ROOT, 'tests', 'coverage-policy.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  }

  static loadImpactPlan(): Record<string, unknown> | null {
    if (!fs.existsSync(IMPACT_PLAN)) return null;
    return JSON.parse(fs.readFileSync(IMPACT_PLAN, 'utf8')) as Record<string, unknown>;
  }

  static async getDashboard(): Promise<RegressionDashboard> {
    const ctx = authBootstrapContext();
    let history: Record<string, unknown>[] = [];
    try {
      history = await dataGateway.readQuery(ctx, 'quality_regression_runs', [30]);
    } catch {
      history = [];
    }

    return {
      latest: this.loadLatestReport(),
      catalog: this.loadCatalog(),
      coveragePolicy: this.loadCoveragePolicy(),
      impactPlan: this.loadImpactPlan(),
      history,
      reportFileExists: fs.existsSync(LATEST_REPORT),
    } as RegressionDashboard & {
      impactPlan: Record<string, unknown> | null;
      coveragePolicy: Record<string, unknown> | null;
    };
  }
}
