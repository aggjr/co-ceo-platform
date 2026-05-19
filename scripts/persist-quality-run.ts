/**
 * Persiste reports/regression-latest.json em quality_test_runs (gateway + SYSTEM_INSTALLER).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';

dotenv.config();

interface RegressionReport {
  id: string;
  mode: string;
  status: string;
  git?: { branch?: string | null; commit?: string | null };
  impact?: { skippedTests?: number } | null;
  summary: { total: number; passed: number; failed: number; skipped: number };
  coverage?: { lines?: number | null };
  units: unknown[];
  suites: unknown[];
}

async function main() {
  const runId = process.argv[2];
  const reportPath = path.join(__dirname, '..', 'reports', 'regression-latest.json');
  if (!fs.existsSync(reportPath)) {
    console.error('Relatório não encontrado. Execute npm run test:regression primeiro.');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RegressionReport;
  const id = runId || report.id;

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 3,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();

  await gateway.insert(ctx, 'quality_test_runs', {
    id,
    run_mode: report.mode,
    status: report.status,
    triggered_by_user_id: process.env.QUALITY_RUN_USER_ID || 'SYSTEM_INSTALLER',
    git_branch: report.git?.branch ?? null,
    git_commit: report.git?.commit ?? null,
    total_tests: report.summary.total,
    passed: report.summary.passed,
    failed: report.summary.failed,
    skipped: report.summary.skipped,
    coverage_lines_pct: report.coverage?.lines ?? null,
    impact_skipped: report.impact?.skippedTests ?? null,
    report_json: {
      units: report.units,
      suites: report.suites,
      impact: report.impact,
      coverage: report.coverage,
    },
  });

  console.log(`✅ Execução ${id} persistida em quality_test_runs.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
